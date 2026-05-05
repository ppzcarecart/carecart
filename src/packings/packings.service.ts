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

    let packing = await this.packings.findOne({
      where: { customerId: order.customerId, status: 'open' },
    });
    if (!packing) {
      packing = this.packings.create({
        customerId: order.customerId,
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
