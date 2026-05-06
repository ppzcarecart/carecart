import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Packing } from './entities/packing.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Role } from '../common/enums/role.enum';

export interface PackingListRow {
  packing: Packing;
  itemCount: number;
  orderCount: number;
  orderNumbers: string[];
  vendorIds: string[];
}

/** One-row-per-customer view used by the Packings list page. */
export interface CustomerPackingRow {
  customerId: string;
  customer?: any;
  packings: Packing[];
  itemCount: number;
  orderCount: number;
  fulfilmentMethods: Array<'delivery' | 'collection'>;
  vendorIds: string[];
  latestUpdatedAt: Date;
  earliestPackedAt?: Date;
}

export interface PackingDetail {
  packing: Packing;
  items: OrderItem[];
  orders: Order[];
}

@Injectable()
export class PackingsService {
  constructor(
    @InjectRepository(Packing)
    private readonly packings: Repository<Packing>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /**
   * Called when an order transitions to `paid`. Finds (or creates) the
   * one OPEN packing for this customer and stamps every freshly-paid
   * item onto it — regardless of vendor — so a customer's multiple
   * unpacked orders consolidate into a single bundle the warehouse
   * pulls together. Idempotent: items already carrying a packingId
   * are skipped, so a webhook replay is safe.
   */
  async assignFromOrder(order: Order): Promise<void> {
    if (!order || !order.customerId || !order.items?.length) return;
    // Defensive: never bundle items from an already-collected,
    // cancelled, or refunded order. The order may carry a paid status
    // when assignFromOrder runs from setPayment, but a webhook replay
    // after collection could revisit this with a stale order, so we
    // re-check here.
    if (
      order.status === 'collected' ||
      order.status === 'cancelled' ||
      order.status === 'refunded'
    ) {
      return;
    }

    const itemIds = order.items
      .filter((i) => !i.packingId)
      .map((i) => i.id);
    if (!itemIds.length) return;

    const fulfilmentMethod = (order.fulfilmentMethod === 'collection'
      ? 'collection'
      : 'delivery') as 'collection' | 'delivery';

    // Heal any legacy duplicates for this customer + method before
    // picking the target.
    await this.consolidateOpenForCustomer(order.customerId, fulfilmentMethod);

    let packing = await this.packings.findOne({
      where: {
        customerId: order.customerId,
        fulfilmentMethod,
        status: 'open',
      },
    });
    if (!packing) {
      packing = this.packings.create({
        customerId: order.customerId,
        fulfilmentMethod,
        status: 'open',
      });
      packing = await this.packings.save(packing);
    }
    await this.orderItems.update(
      { id: In(itemIds) },
      { packingId: packing.id },
    );
    // Bump updatedAt so list sorting reflects recent activity.
    await this.packings.save({ ...packing, updatedAt: new Date() });
  }

  /**
   * Merge any duplicate OPEN packings for a single (customer, method)
   * into the oldest one. Reassigns the items from the duplicates and
   * deletes the now-empty packing rows. Idempotent — safe to call
   * freely.
   */
  private async consolidateOpenForCustomer(
    customerId: string,
    fulfilmentMethod: 'delivery' | 'collection',
  ): Promise<void> {
    const open = await this.packings.find({
      where: { customerId, fulfilmentMethod, status: 'open' },
      order: { createdAt: 'ASC' },
    });
    if (open.length <= 1) return;
    const target = open[0];
    const otherIds = open.slice(1).map((p) => p.id);
    await this.orderItems.update(
      { packingId: In(otherIds) },
      { packingId: target.id },
    );
    await this.packings.save({ ...target, updatedAt: new Date() });
    await this.packings.delete({ id: In(otherIds) });
  }

  /**
   * Sweep up any paid/fulfilled/collected order whose items still
   * have NULL packingId — those are orders that were paid before
   * the packing-assignment hook existed (pre-feature) or fell
   * through a code path that didn't trigger assignFromOrder. Running
   * each through assignFromOrder routes them into the right
   * (customer, method) bundle. Idempotent: an order whose items
   * already carry a packingId is skipped inside assignFromOrder.
   */
  async backfillUnpackedPaidOrders(): Promise<void> {
    // Only paid/fulfilled — never 'collected' (already picked up so it
    // doesn't belong in an open bundle), 'cancelled', or 'refunded'.
    const rows = await this.orderItems
      .createQueryBuilder('item')
      .innerJoin('item.order', 'o')
      .select('DISTINCT item.orderId', 'orderId')
      .where('item.packingId IS NULL')
      .andWhere("o.status IN ('paid', 'fulfilled')")
      .andWhere('o.customerId IS NOT NULL')
      .getRawMany<{ orderId: string }>();
    for (const row of rows) {
      const order = await this.orders.findOne({ where: { id: row.orderId } });
      if (!order) continue;
      await this.assignFromOrder(order);
    }
  }

  /**
   * Walk every (customer, method) that currently has more than one
   * open packing and merge them. Cheap when there's nothing to do
   * (a single grouped query) so it's safe to call on every list
   * render — that way the UI is self-healing for legacy data without
   * any manual migration.
   */
  private async consolidateAllOpen(): Promise<void> {
    const dupRows = await this.packings
      .createQueryBuilder('p')
      .select('p.customerId', 'customerId')
      .addSelect('p.fulfilmentMethod', 'fulfilmentMethod')
      .addSelect('COUNT(*)', 'cnt')
      .where("p.status = 'open'")
      .andWhere('p.customerId IS NOT NULL')
      .andWhere('p.fulfilmentMethod IS NOT NULL')
      .groupBy('p.customerId')
      .addGroupBy('p.fulfilmentMethod')
      .having('COUNT(*) > 1')
      .getRawMany<{
        customerId: string;
        fulfilmentMethod: 'delivery' | 'collection';
        cnt: string;
      }>();
    for (const row of dupRows) {
      await this.consolidateOpenForCustomer(
        row.customerId,
        row.fulfilmentMethod,
      );
    }
  }

  /**
   * Detach all of an order's items from any open packing — used when an
   * order is cancelled or refunded so the packing list reflects only
   * actually shippable items. Packed packings are left alone (those
   * items have already been physically packed).
   */
  async detachOrder(orderId: string): Promise<void> {
    const items = await this.orderItems.find({
      where: { orderId },
    });
    const ids = items.filter((i) => i.packingId).map((i) => i.id);
    if (!ids.length) return;
    // Only detach from OPEN packings.
    const packingIds = Array.from(
      new Set(items.map((i) => i.packingId).filter((x): x is string => !!x)),
    );
    const openPackings = await this.packings.find({
      where: { id: In(packingIds), status: 'open' },
    });
    const openIds = new Set(openPackings.map((p) => p.id));
    const detachIds = items
      .filter((i) => i.packingId && openIds.has(i.packingId))
      .map((i) => i.id);
    if (!detachIds.length) return;
    await this.orderItems.update({ id: In(detachIds) }, { packingId: null as any });
  }

  /**
   * Listing for the packings page. Loads packings with a roll-up of
   * how many items / how many distinct orders each one currently
   * holds. Filters:
   *   status — 'open' | 'packed' (default 'open')
   *   vendorId — vendor scope: only packings containing at least one
   *              of this vendor's items, and the counts reflect only
   *              that vendor's items so the list says exactly what
   *              they need to pack.
   * Empty open packings (everything inside got cancelled) are hidden.
   */
  async list(opts: {
    status?: 'open' | 'packed';
    vendorId?: string;
  }): Promise<PackingListRow[]> {
    const status = opts.status || 'open';

    // Self-heal in two passes:
    //  1. Pull in any paid/fulfilled orders whose items never got a
    //     packingId (pre-feature data or a code path that bypassed
    //     assignFromOrder). They land in the correct (customer,
    //     method) bundle automatically.
    //  2. Merge any legacy duplicate open packings for a single
    //     (customer, method) into one row.
    if (status === 'open') {
      await this.backfillUnpackedPaidOrders();
      await this.consolidateAllOpen();
    }

    let candidateIds: string[] | null = null;
    if (opts.vendorId) {
      const rows = await this.orderItems
        .createQueryBuilder('item')
        .select('DISTINCT item.packingId', 'pid')
        .where('item.packingId IS NOT NULL')
        .andWhere('item.vendorId = :vid', { vid: opts.vendorId })
        .getRawMany<{ pid: string }>();
      candidateIds = rows.map((r) => r.pid);
      if (!candidateIds.length) return [];
    }

    const packings = await this.packings.find({
      where: candidateIds
        ? { id: In(candidateIds), status }
        : { status },
      order: { updatedAt: 'DESC' },
    });
    if (!packings.length) return [];

    const ids = packings.map((p) => p.id);
    const items = await this.orderItems.find({
      where: { packingId: In(ids) },
    });

    const rows: PackingListRow[] = packings.map((p) => {
      const own = items.filter(
        (i) =>
          i.packingId === p.id &&
          (!opts.vendorId || i.vendorId === opts.vendorId),
      );
      const orderNumbers = Array.from(new Set(own.map((i) => i.orderId)));
      const vendorIds = Array.from(
        new Set(own.map((i) => i.vendorId).filter((x): x is string => !!x)),
      );
      return {
        packing: p,
        itemCount: own.reduce((s, i) => s + (i.quantity || 0), 0),
        orderCount: orderNumbers.length,
        orderNumbers,
        vendorIds,
      };
    });
    const filtered = rows.filter(
      (r) => status === 'packed' || r.itemCount > 0,
    );

    // Group rows by customer so each customer renders as a single
    // contiguous block in the table. Within a group we keep
    // collection above delivery (collection is the workflow with the
    // tighter timeline), and we sort customers by their group's most
    // recent activity so newly active customers float to the top.
    const order = (m?: string) => (m === 'collection' ? 0 : 1);
    const byCustomer = new Map<string, PackingListRow[]>();
    for (const r of filtered) {
      const key = r.packing.customerId || '__no_customer__';
      const arr = byCustomer.get(key) || [];
      arr.push(r);
      byCustomer.set(key, arr);
    }
    const sortedGroups = Array.from(byCustomer.values()).sort((a, b) => {
      const aTs = Math.max(...a.map((r) => +new Date(r.packing.updatedAt)));
      const bTs = Math.max(...b.map((r) => +new Date(r.packing.updatedAt)));
      return bTs - aTs;
    });
    const out: PackingListRow[] = [];
    for (const group of sortedGroups) {
      group.sort(
        (a, b) =>
          order(a.packing.fulfilmentMethod) -
          order(b.packing.fulfilmentMethod),
      );
      out.push(...group);
    }
    return out;
  }

  /**
   * Customer-grouped roll-up of `list()`. Each row is a single
   * customer with the array of packings they currently have in the
   * given status (open or packed). Counts add across all the
   * customer's bundles so the row reflects everything the warehouse
   * needs to do for that customer.
   */
  async listByCustomer(opts: {
    status?: 'open' | 'packed';
    vendorId?: string;
  }): Promise<CustomerPackingRow[]> {
    const flat = await this.list(opts);
    const byCustomer = new Map<string, CustomerPackingRow>();
    for (const r of flat) {
      const key = r.packing.customerId || '';
      if (!key) continue;
      let row = byCustomer.get(key);
      if (!row) {
        row = {
          customerId: key,
          customer: r.packing.customer,
          packings: [],
          itemCount: 0,
          orderCount: 0,
          fulfilmentMethods: [],
          vendorIds: [],
          latestUpdatedAt: r.packing.updatedAt,
          earliestPackedAt: r.packing.packedAt,
        };
        byCustomer.set(key, row);
      }
      row.packings.push(r.packing);
      row.itemCount += r.itemCount;
      row.orderCount += r.orderCount;
      const m = r.packing.fulfilmentMethod;
      if (m && !row.fulfilmentMethods.includes(m)) {
        row.fulfilmentMethods.push(m);
      }
      for (const v of r.vendorIds) {
        if (!row.vendorIds.includes(v)) row.vendorIds.push(v);
      }
      const u = new Date(r.packing.updatedAt);
      if (u > row.latestUpdatedAt) row.latestUpdatedAt = u;
      if (r.packing.packedAt) {
        if (!row.earliestPackedAt || r.packing.packedAt < row.earliestPackedAt) {
          row.earliestPackedAt = r.packing.packedAt;
        }
      }
    }
    return Array.from(byCustomer.values()).sort(
      (a, b) => +b.latestUpdatedAt - +a.latestUpdatedAt,
    );
  }

  /**
   * Load every open packing for one customer plus their items/orders,
   * for the customer-scoped detail page. Vendors only see bundles
   * containing at least one of their items, and only their own items
   * in those bundles.
   */
  async findCustomerDetail(opts: {
    customerId: string;
    vendorId?: string;
    status?: 'open' | 'packed';
  }): Promise<{
    customer?: any;
    bundles: Array<{
      packing: Packing;
      items: OrderItem[];
      orders: Order[];
    }>;
  }> {
    const status = opts.status || 'open';
    const packings = await this.packings.find({
      where: { customerId: opts.customerId, status },
      order: { fulfilmentMethod: 'ASC', createdAt: 'ASC' },
    });
    if (!packings.length) {
      return { customer: undefined, bundles: [] };
    }
    const ids = packings.map((p) => p.id);
    const allItems = await this.orderItems.find({
      where: { packingId: In(ids) },
    });
    const orderIds = Array.from(new Set(allItems.map((i) => i.orderId)));
    const orders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];

    const visiblePackings = opts.vendorId
      ? packings.filter((p) =>
          allItems.some(
            (i) => i.packingId === p.id && i.vendorId === opts.vendorId,
          ),
        )
      : packings;

    const bundles = visiblePackings.map((p) => {
      const own = allItems.filter(
        (i) =>
          i.packingId === p.id &&
          (!opts.vendorId || i.vendorId === opts.vendorId),
      );
      const ownOrderIds = new Set(own.map((i) => i.orderId));
      return {
        packing: p,
        items: own,
        orders: orders.filter((o) => ownOrderIds.has(o.id)),
      };
    });
    return { customer: packings[0].customer, bundles };
  }

  /**
   * Mark every OPEN packing the customer currently has as packed in
   * one click. Vendors are constrained to their own bundles.
   */
  async markAllPackedForCustomer(
    customerId: string,
    actor: { id: string; role: Role },
  ): Promise<{ packed: number }> {
    const open = await this.packings.find({
      where: { customerId, status: 'open' },
    });
    if (!open.length) return { packed: 0 };
    let count = 0;
    for (const p of open) {
      try {
        await this.markPacked(p.id, actor);
        count++;
      } catch (e) {
        // A vendor packing one customer's bundles may legitimately not
        // own every bundle (e.g. another vendor has the delivery
        // half) — skip rather than abort the whole batch.
        if (e instanceof ForbiddenException) continue;
        throw e;
      }
    }
    return { packed: count };
  }

  async findDetail(id: string, vendorId?: string): Promise<PackingDetail> {
    const packing = await this.packings.findOne({ where: { id } });
    if (!packing) throw new NotFoundException('Packing not found');
    const allItems = await this.orderItems.find({ where: { packingId: id } });
    if (vendorId && !allItems.some((i) => i.vendorId === vendorId)) {
      throw new ForbiddenException();
    }
    // Vendors only see their own items in the bundle, so they pack
    // exactly what they're responsible for.
    const items = vendorId
      ? allItems.filter((i) => i.vendorId === vendorId)
      : allItems;
    const orderIds = Array.from(new Set(items.map((i) => i.orderId)));
    const orders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];
    return { packing, items, orders };
  }

  /**
   * Resolve a scanned QR / typed value into the matching packing. The
   * QR a customer shows at pickup encodes the packing.id (UUID), so we
   * try that first. As a fallback for staff who type an order number,
   * we also resolve "this order's packing".
   */
  async findByScannedValue(value: string): Promise<Packing | null> {
    const v = (value || '').trim();
    if (!v) return null;
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        v,
      );
    if (isUuid) {
      const direct = await this.packings.findOne({ where: { id: v } });
      if (direct) return direct;
    }
    const order = await this.orders.findOne({ where: { number: v } });
    if (!order) return null;
    const item = await this.orderItems.findOne({
      where: { orderId: order.id },
    });
    if (!item || !item.packingId) return null;
    return this.packings.findOne({ where: { id: item.packingId } });
  }

  async findPackingForOrder(orderId: string): Promise<Packing | null> {
    const item = await this.orderItems.findOne({ where: { orderId } });
    if (!item || !item.packingId) return null;
    return this.packings.findOne({ where: { id: item.packingId } });
  }

  /**
   * Mark a packing as collected. Cascades to every constituent
   * order: order.status = 'collected', collectedAt + collectedById
   * stamped. Idempotent at the order level — orders already in
   * 'collected' are left alone.
   */
  async markCollected(
    id: string,
    actor: { id: string; role: Role },
  ): Promise<{ packing: Packing; orderNumbers: string[] }> {
    const packing = await this.packings.findOne({ where: { id } });
    if (!packing) throw new NotFoundException('Packing not found');
    if (packing.status === 'collected') {
      throw new BadRequestException('Packing was already collected');
    }
    if (packing.status !== 'packed') {
      throw new BadRequestException(
        'Packing is not packed yet — finish packing it first',
      );
    }
    if (actor.role === Role.VENDOR) {
      const owned = await this.orderItems.findOne({
        where: { packingId: id, vendorId: actor.id },
      });
      if (!owned) {
        throw new ForbiddenException(
          'This packing has none of your items',
        );
      }
    }
    const items = await this.orderItems.find({ where: { packingId: id } });
    const orderIds = Array.from(new Set(items.map((i) => i.orderId)));
    const orders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];
    const now = new Date();
    const orderNumbers: string[] = [];
    for (const o of orders) {
      orderNumbers.push(o.number);
      if (o.status === 'collected') continue;
      o.status = 'collected';
      o.collectedAt = now;
      o.collectedById = actor.id;
      await this.orders.save(o);
    }
    packing.status = 'collected';
    packing.collectedAt = now;
    packing.collectedById = actor.id;
    const saved = await this.packings.save(packing);
    return { packing: saved, orderNumbers };
  }

  async markPacked(
    id: string,
    actor: { id: string; role: Role },
  ): Promise<Packing> {
    const packing = await this.packings.findOne({ where: { id } });
    if (!packing) throw new NotFoundException('Packing not found');
    if (packing.status === 'packed') {
      throw new BadRequestException('Packing is already packed');
    }
    if (actor.role === Role.VENDOR) {
      const owned = await this.orderItems.findOne({
        where: { packingId: id, vendorId: actor.id },
      });
      if (!owned) {
        throw new ForbiddenException(
          'This packing has none of your items',
        );
      }
    }
    packing.status = 'packed';
    packing.packedAt = new Date();
    packing.packedById = actor.id;
    return this.packings.save(packing);
  }
}
