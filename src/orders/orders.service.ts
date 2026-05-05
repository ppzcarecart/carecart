import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { ProductsService } from '../products/products.service';
import { CartService } from '../cart/cart.service';
import { PointsService } from '../points/points.service';
import { Role } from '../common/enums/role.enum';
import { StripeProvider } from '../payments/providers/stripe.provider';
import { PackingsService } from '../packings/packings.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(OrderItem) private orderItems: Repository<OrderItem>,
    private products: ProductsService,
    private cart: CartService,
    private points: PointsService,
    private stripe: StripeProvider,
    private packings: PackingsService,
  ) {}

  private generateNumber() {
    return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1000);
  }

  /**
   * Create an order from the user's cart. Decrements stock atomically per line.
   */
  async createFromCart(
    userId: string,
    shippingAddress: Record<string, any> | undefined,
    paymentProvider: string,
    fulfilmentMethod: 'delivery' | 'collection' = 'delivery',
  ): Promise<Order> {
    const summary = await this.cart.summary(userId, fulfilmentMethod);
    if (!summary.cart.items.length) throw new BadRequestException('Cart is empty');
    if (fulfilmentMethod === 'delivery' && !summary.deliveryEnabled) {
      throw new BadRequestException('Delivery is currently disabled');
    }
    if (fulfilmentMethod === 'delivery' && summary.collectionOnlyForced) {
      throw new BadRequestException(
        'Your cart contains collection-only items — please switch to self-collection to checkout',
      );
    }

    const order = this.orders.create({
      number: this.generateNumber(),
      customerId: userId,
      status: 'awaiting_payment',
      subtotalCents: summary.subtotalCents,
      totalCents: summary.subtotalCents + summary.deliveryFeeCents,
      pointsTotal: summary.pointsTotal,
      currency: 'SGD',
      fulfilmentMethod,
      deliveryFeeCents: summary.deliveryFeeCents,
      collectionPoints:
        fulfilmentMethod === 'collection' ? summary.collectionPoints : null,
      shippingAddress: fulfilmentMethod === 'delivery' ? shippingAddress : null,
      paymentProvider,
      items: [],
    });

    for (const line of summary.lines) {
      const product = line.item.product;
      const variant = line.item.variant;

      // Stock check + decrement
      if (variant) {
        if (variant.stock < line.item.quantity) {
          throw new BadRequestException(`Insufficient stock for ${product.name} - ${variant.name}`);
        }
        variant.stock -= line.item.quantity;
        await this.products.updateStock(product.id, variant.id, variant.stock, {
          id: product.vendorId,
          role: Role.ADMIN, // bypass vendor ownership for stock decrement during checkout
        });
      } else {
        if (product.stock < line.item.quantity) {
          throw new BadRequestException(`Insufficient stock for ${product.name}`);
        }
        product.stock -= line.item.quantity;
        await this.products.updateStock(product.id, undefined, product.stock, {
          id: product.vendorId,
          role: Role.ADMIN,
        });
      }

      // unitCashCents + unitPoints are the actual amounts billed for
      // this line. For 'points' mode they reflect the hybrid offset
      // (e.g. $10 + 500 pts when 500 pts redeems half of a $20
      // product); for 'price' mode unitPoints is 0.
      const item = this.orderItems.create({
        productId: product.id,
        variantId: variant?.id,
        vendorId: product.vendorId,
        productName: variant ? `${product.name} - ${variant.name}` : product.name,
        quantity: line.item.quantity,
        unitPriceCents: line.unitCashCents,
        unitPoints: line.unitPoints,
        pricingMode: line.item.pricingMode,
      });
      order.items.push(item);
    }

    const saved = await this.orders.save(order);
    await this.cart.clear(userId);
    return saved;
  }

  findById(id: string) {
    return this.orders.findOne({ where: { id } });
  }

  findByNumber(number: string) {
    return this.orders.findOne({ where: { number } });
  }

  async listForUser(userId: string) {
    return this.orders.find({
      where: { customerId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  // Admin/manager view of all orders
  listAll(filter?: { status?: OrderStatus; vendorId?: string }) {
    if (filter?.vendorId) {
      // orders that contain at least one item from this vendor
      return this.orders
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.items', 'items')
        .leftJoinAndSelect('o.customer', 'customer')
        .where('items.vendorId = :vendorId', { vendorId: filter.vendorId })
        .orderBy('o.createdAt', 'DESC')
        .getMany();
    }
    return this.orders.find({
      where: filter?.status ? { status: filter.status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async setStatus(id: string, status: OrderStatus) {
    const order = await this.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'refunded' && status !== 'refunded') {
      throw new BadRequestException(
        'Order has been refunded and cannot change status',
      );
    }
    const prev = order.status;
    order.status = status;
    const saved = await this.orders.save(order);
    if (prev !== 'paid' && status === 'paid') {
      await this.packings.assignFromOrder(saved);
    }
    return saved;
  }

  /**
   * Issue a refund. Admin/manager can refund any order. Vendors can only
   * refund orders that contain at least one of their items. Refunds the
   * customer's PPZ points (if any) via the partner API with reason
   * "Refund - <orderNumber>", marks the order status as refunded, and
   * locks the status from further changes.
   */
  async refund(
    id: string,
    actor: { id: string; role: Role },
    reason: string,
  ): Promise<Order> {
    const trimmed = (reason || '').trim();
    if (!trimmed) {
      throw new BadRequestException('A refund reason is required');
    }
    if (trimmed.length > 500) {
      throw new BadRequestException('Refund reason is too long (max 500)');
    }

    const order = await this.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'refunded') {
      throw new BadRequestException('Order is already refunded');
    }

    if (
      actor.role === Role.VENDOR &&
      !order.items.some((i) => i.vendorId === actor.id)
    ) {
      throw new ForbiddenException(
        'You can only refund orders that contain your items',
      );
    }
    if (
      actor.role !== Role.ADMIN &&
      actor.role !== Role.MANAGER &&
      actor.role !== Role.VENDOR
    ) {
      throw new ForbiddenException();
    }

    // Refund PPZ points if the order had a points component. The reason
    // travels along to the partner-API description so it shows up in the
    // customer's PPZ transaction history.
    if (order.pointsTotal > 0 && order.customerId) {
      await this.points.refund(
        order.customerId,
        order.pointsTotal,
        order.id,
        order.number,
        trimmed,
      );
    }

    order.status = 'refunded';
    order.refundReason = trimmed;
    const saved = await this.orders.save(order);
    // Detach from any open packing so the bundle no longer lists items
    // that won't actually ship.
    await this.packings.detachOrder(saved.id);
    return saved;
  }

  /**
   * Cancel an order that's still awaiting payment. Admin/manager can
   * cancel any awaiting_payment order; vendors can only cancel orders
   * that contain at least one of their items. The flow:
   *
   *   1. Reverse any pre-redeemed PPZ points (payments.start() debits
   *      the customer's points before opening the Stripe intent — if
   *      we don't reverse, the customer ends up out-of-pocket on a
   *      cancellation they didn't initiate).
   *   2. Best-effort cancel the Stripe PaymentIntent so the QR can't
   *      be paid after the fact. Already-cancelled / already-paid
   *      intents are ignored.
   *   3. Restore stock for every line that was decremented at order
   *      creation.
   *   4. Stamp status = 'cancelled' and persist the reason in
   *      refundReason (the column does dual duty for refund and
   *      cancel remarks).
   *
   * Refund is for orders that have already been paid; this is the
   * unpaid counterpart.
   */
  async cancel(
    id: string,
    actor: { id: string; role: Role },
    reason: string,
  ): Promise<Order> {
    const trimmed = (reason || '').trim();
    if (!trimmed) {
      throw new BadRequestException('A cancellation reason is required');
    }
    if (trimmed.length > 500) {
      throw new BadRequestException('Cancellation reason is too long (max 500)');
    }

    const order = await this.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== 'awaiting_payment' && order.status !== 'pending') {
      throw new BadRequestException(
        `Order ${order.number} is "${order.status}" — only pending / awaiting_payment orders can be cancelled. Use Issue refund for paid orders.`,
      );
    }

    if (
      actor.role === Role.VENDOR &&
      !order.items.some((i) => i.vendorId === actor.id)
    ) {
      throw new ForbiddenException(
        'You can only cancel orders that contain your items',
      );
    }
    if (
      actor.role !== Role.ADMIN &&
      actor.role !== Role.MANAGER &&
      actor.role !== Role.VENDOR
    ) {
      throw new ForbiddenException();
    }

    // 1. Reverse points if any were pre-redeemed.
    if (order.pointsTotal > 0 && order.customerId) {
      await this.points.reverse(
        order.customerId,
        order.pointsTotal,
        order.id,
        order.number,
      );
    }

    // 2. Cancel the Stripe intent if one was opened. Errors here are
    // logged inside the provider and don't block the order's terminal
    // state — a dangling intent is harmless because awaiting_payment
    // intents auto-expire and the order itself is now 'cancelled'.
    if (order.paymentIntentId && order.paymentProvider === 'stripe') {
      await this.stripe.cancelIntent(order.paymentIntentId);
    }

    // 3. Restore stock per line. Use Role.ADMIN as the actor so the
    // updateStock call doesn't reject on vendor ownership when the
    // canceller is admin/manager (or a vendor canceling a multi-vendor
    // order). The stock numbers are authoritative on the product/variant
    // entities, not on the order item.
    for (const item of order.items) {
      if (!item.productId) continue;
      const product = await this.products.findById(item.productId);
      if (!product) continue;
      if (item.variantId) {
        const variant = product.variants?.find((v) => v.id === item.variantId);
        if (!variant) continue;
        await this.products.updateStock(
          product.id,
          variant.id,
          variant.stock + item.quantity,
          { id: product.vendorId, role: Role.ADMIN },
        );
      } else {
        await this.products.updateStock(
          product.id,
          undefined,
          product.stock + item.quantity,
          { id: product.vendorId, role: Role.ADMIN },
        );
      }
    }

    // 4. Lock terminal state + capture reason.
    order.status = 'cancelled';
    order.refundReason = trimmed;
    const saved = await this.orders.save(order);
    await this.packings.detachOrder(saved.id);
    return saved;
  }

  async setPayment(id: string, paymentIntentId: string, status: OrderStatus) {
    const order = await this.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    const prev = order.status;
    order.paymentIntentId = paymentIntentId;
    order.status = status;
    const saved = await this.orders.save(order);
    if (prev !== 'paid' && status === 'paid') {
      await this.packings.assignFromOrder(saved);
    }
    return saved;
  }

  /**
   * Aggregated product sales for the Sales Report views.
   *   vendorId — scope to one vendor (vendor's own report). Omit for
   *              the marketplace-wide admin report.
   *   since / until — inclusive date bounds on order.createdAt.
   *
   * Counts orders in any "money received" status: paid, fulfilled,
   * or collected. Cancelled / refunded / awaiting_payment orders are
   * excluded so the report reflects realised sales.
   *
   * Groups by productName + vendorId so the same product name from
   * two different vendors stays on separate rows in the all-vendors
   * view, and we can join the vendor for display.
   */
  async salesSummary(opts: {
    vendorId?: string;
    since?: Date;
    until?: Date;
  }) {
    const qb = this.orderItems
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where("order.status IN ('paid', 'fulfilled', 'collected')");

    if (opts.vendorId) {
      qb.andWhere('item.vendorId = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.since) {
      qb.andWhere('order.createdAt >= :since', { since: opts.since });
    }
    if (opts.until) {
      qb.andWhere('order.createdAt < :until', { until: opts.until });
    }

    // Postgres lowercases unquoted identifiers, so the raw aliases use
    // lowercase. vendorid is selected so the admin view can resolve a
    // vendor display name for each row.
    const rows = await qb
      .select('item.productName', 'productname')
      .addSelect('item.vendorId', 'vendorid')
      .addSelect('SUM(item.quantity)', 'unitssold')
      .addSelect('SUM(item.quantity * item.unitPriceCents)', 'revenuecents')
      .addSelect('SUM(item.quantity * item.unitPoints)', 'pointscollected')
      .groupBy('item.productName')
      .addGroupBy('item.vendorId')
      .orderBy('revenuecents', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      productName: r.productname,
      vendorId: r.vendorid as string | null,
      unitsSold: parseInt(r.unitssold, 10) || 0,
      revenueCents: parseInt(r.revenuecents, 10) || 0,
      pointsCollected: parseInt(r.pointscollected, 10) || 0,
    }));
  }

  // Backward-compat: keeps the existing /vendor dashboard render and
  // the /api/orders/vendor/sales endpoint working without a signature
  // change. Just delegates to salesSummary.
  vendorSalesSummary(vendorId: string) {
    return this.salesSummary({ vendorId });
  }

  /**
   * Per-order-line view of realised sales, used alongside salesSummary
   * on the Sales report. Joins the order + customer so the report can
   * show who bought what (name, customer type, PPZ ID).
   *
   * Same status / vendorId / date filters as salesSummary so totals at
   * the top of the page line up with the line items below.
   */
  async salesLines(opts: {
    vendorId?: string;
    since?: Date;
    until?: Date;
  }) {
    const qb = this.orderItems
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .leftJoin('order.customer', 'customer')
      .where("order.status IN ('paid', 'fulfilled', 'collected')");

    if (opts.vendorId) {
      qb.andWhere('item.vendorId = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.since) {
      qb.andWhere('order.createdAt >= :since', { since: opts.since });
    }
    if (opts.until) {
      qb.andWhere('order.createdAt < :until', { until: opts.until });
    }

    const rows = await qb
      .select('item.id', 'itemid')
      .addSelect('item.productName', 'productname')
      .addSelect('item.quantity', 'quantity')
      .addSelect('item.unitPriceCents', 'unitpricecents')
      .addSelect('item.unitPoints', 'unitpoints')
      .addSelect('item.vendorId', 'vendorid')
      .addSelect('order.id', 'orderid')
      .addSelect('order.number', 'ordernumber')
      .addSelect('order.status', 'orderstatus')
      .addSelect('order.createdAt', 'createdat')
      .addSelect('customer.name', 'customername')
      .addSelect('customer.email', 'customeremail')
      .addSelect('customer.ppzId', 'customerppzid')
      .orderBy('order.createdAt', 'DESC')
      .getRawMany();

    return rows.map((r) => {
      const qty = parseInt(r.quantity, 10) || 0;
      const unitPriceCents = parseInt(r.unitpricecents, 10) || 0;
      const unitPoints = parseInt(r.unitpoints, 10) || 0;
      return {
        itemId: r.itemid as string,
        productName: r.productname as string,
        quantity: qty,
        unitPriceCents,
        unitPoints,
        lineRevenueCents: qty * unitPriceCents,
        linePoints: qty * unitPoints,
        vendorId: r.vendorid as string | null,
        orderId: r.orderid as string,
        orderNumber: r.ordernumber as string,
        orderStatus: r.orderstatus as string,
        createdAt: r.createdat as Date,
        customerName: (r.customername as string | null) || null,
        customerEmail: (r.customeremail as string | null) || null,
        customerPpzId: (r.customerppzid as string | null) || null,
      };
    });
  }

  async vendorOrders(vendorId: string) {
    return this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('o.customer', 'customer')
      .where('items.vendorId = :vendorId', { vendorId })
      .orderBy('o.createdAt', 'DESC')
      .getMany();
  }
}
