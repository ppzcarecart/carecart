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
   * Called when an order transitions to `paid`. Splits the order's items
   * by vendor, finds (or creates) an OPEN packing for each
   * (customer, vendor) pair, and stamps `packingId` onto the items.
   * Idempotent — items that already carry a packingId are skipped so
   * re-firing the hook (e.g. webhook replay) doesn't duplicate.
   */
  async assignFromOrder(order: Order): Promise<void> {
    if (!order || !order.customerId || !order.items?.length) return;

    const itemsByVendor = new Map<string, OrderItem[]>();
    for (const item of order.items) {
      if (item.packingId) continue;
      const key = item.vendorId || '';
      const arr = itemsByVendor.get(key) || [];
      arr.push(item);
      itemsByVendor.set(key, arr);
    }
    if (!itemsByVendor.size) return;

    for (const [vendorId, items] of itemsByVendor.entries()) {
      let packing = await this.packings.findOne({
        where: {
          customerId: order.customerId,
          vendorId: vendorId || undefined,
          status: 'open',
        },
      });
      if (!packing) {
        packing = this.packings.create({
          customerId: order.customerId,
          vendorId: vendorId || undefined,
          status: 'open',
        });
        packing = await this.packings.save(packing);
      }
      const itemIds = items.map((i) => i.id);
      await this.orderItems.update(
        { id: In(itemIds) },
        { packingId: packing.id },
      );
      // Bump updatedAt so the list naturally re-sorts the most-recently
      // added packing to the top.
      await this.packings.save({ ...packing, updatedAt: new Date() });
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
   *   vendorId — limit to a single vendor (vendor's own view)
   * Empty open packings (everything inside got cancelled) are hidden.
   */
  async list(opts: {
    status?: 'open' | 'packed';
    vendorId?: string;
  }): Promise<PackingListRow[]> {
    const where: any = { status: opts.status || 'open' };
    if (opts.vendorId) where.vendorId = opts.vendorId;
    const packings = await this.packings.find({
      where,
      order: { updatedAt: 'DESC' },
    });
    if (!packings.length) return [];
    const ids = packings.map((p) => p.id);
    const items = await this.orderItems.find({ where: { packingId: In(ids) } });

    const rows: PackingListRow[] = packings.map((p) => {
      const own = items.filter((i) => i.packingId === p.id);
      const orderNumbers = Array.from(new Set(own.map((i) => i.orderId)));
      return {
        packing: p,
        itemCount: own.reduce((s, i) => s + (i.quantity || 0), 0),
        orderCount: orderNumbers.length,
        orderNumbers,
      };
    });
    // Hide empty open packings (e.g. all underlying orders got cancelled).
    return rows.filter((r) => opts.status === 'packed' || r.itemCount > 0);
  }

  async findDetail(id: string, vendorId?: string): Promise<PackingDetail> {
    const packing = await this.packings.findOne({ where: { id } });
    if (!packing) throw new NotFoundException('Packing not found');
    if (vendorId && packing.vendorId !== vendorId) {
      throw new ForbiddenException();
    }
    const items = await this.orderItems.find({ where: { packingId: id } });
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
    if (
      actor.role === Role.VENDOR &&
      packing.vendorId &&
      packing.vendorId !== actor.id
    ) {
      throw new ForbiddenException(
        'You can only pack your own bundles',
      );
    }
    packing.status = 'packed';
    packing.packedAt = new Date();
    packing.packedById = actor.id;
    return this.packings.save(packing);
  }
}
