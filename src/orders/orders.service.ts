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

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(OrderItem) private orderItems: Repository<OrderItem>,
    private products: ProductsService,
    private cart: CartService,
    private points: PointsService,
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

      const item = this.orderItems.create({
        productId: product.id,
        variantId: variant?.id,
        vendorId: product.vendorId,
        productName: variant ? `${product.name} - ${variant.name}` : product.name,
        quantity: line.item.quantity,
        unitPriceCents: line.item.pricingMode === 'price' ? line.priceCents : 0,
        unitPoints: line.item.pricingMode === 'points' && line.pointsPrice != null ? line.pointsPrice : 0,
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
    order.status = status;
    return this.orders.save(order);
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
    return this.orders.save(order);
  }

  async setPayment(id: string, paymentIntentId: string, status: OrderStatus) {
    const order = await this.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    order.paymentIntentId = paymentIntentId;
    order.status = status;
    return this.orders.save(order);
  }

  // Vendor-facing report: aggregated sales for a vendor's items
  async vendorSalesSummary(vendorId: string) {
    // Postgres lowercases unquoted identifiers, so we use lowercase aliases.
    const rows = await this.orderItems
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('item.vendorId = :vendorId', { vendorId })
      .andWhere("order.status IN ('paid', 'fulfilled')")
      .select('item.productName', 'productname')
      .addSelect('SUM(item.quantity)', 'unitssold')
      .addSelect('SUM(item.quantity * item.unitPriceCents)', 'revenuecents')
      .addSelect('SUM(item.quantity * item.unitPoints)', 'pointscollected')
      .groupBy('item.productName')
      .orderBy('revenuecents', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      productName: r.productname,
      unitsSold: parseInt(r.unitssold, 10) || 0,
      revenueCents: parseInt(r.revenuecents, 10) || 0,
      pointsCollected: parseInt(r.pointscollected, 10) || 0,
    }));
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
