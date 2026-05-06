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

    // Self-heal: any customers with multiple open packings (legacy
    // per-vendor split) get merged before we render the list.
    if (status === 'open') {
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
    return rows.filter((r) => status === 'packed' || r.itemCount > 0);
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
