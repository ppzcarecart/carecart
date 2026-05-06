import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity';
import { CollectionLog, CollectionResult } from './entities/collection-log.entity';
import { Role } from '../common/enums/role.enum';

export interface ScanOutcome {
  result: CollectionResult;
  message: string;
  order?: {
    id: string;
    number: string;
    status: string;
    customerName?: string;
    customerEmail?: string;
    customerContact?: string;
    customerPpzId?: string;
    fulfilmentMethod: string;
    totalCents: number;
    pointsTotal: number;
    items: Array<{
      productName: string;
      vendorId?: string;
      vendorName?: string;
      quantity: number;
      pricingMode: string;
    }>;
    collectedAt?: Date;
    collectedByName?: string;
    placedAt: Date;
  };
}

@Injectable()
export class CollectionService {
  constructor(
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(CollectionLog) private logs: Repository<CollectionLog>,
  ) {}

  /**
   * Validate a scanned QR / typed order number against the rules for the
   * acting user. Logs the attempt only when the result is not 'success'
   * (so a successful scan + later mark only writes one log row).
   *
   * Vendors may only scan orders that contain at least one of their items.
   * Admins/managers may scan any order.
   */
  async scan(
    scannedValue: string,
    actor: { id: string; role: Role },
  ): Promise<ScanOutcome> {
    const value = (scannedValue || '').trim();
    if (!value) {
      return { result: 'not_found', message: 'Empty scan' };
    }

    const order = await this.orders.findOne({ where: { number: value } });
    if (!order) {
      // Don't log random misreads — they're noise.
      return {
        result: 'not_found',
        message: `No order matches "${value}".`,
      };
    }

    if (order.fulfilmentMethod !== 'collection') {
      const outcome: ScanOutcome = {
        result: 'invalid_state',
        message: `Order ${order.number} is for delivery, not collection.`,
        order: this.shapeOrder(order),
      };
      await this.log(value, order.id, actor.id, 'invalid_state', outcome.message);
      return outcome;
    }

    if (
      actor.role === Role.VENDOR &&
      !order.items.some((i) => i.vendorId === actor.id)
    ) {
      const outcome: ScanOutcome = {
        result: 'unauthorized_vendor',
        message: `Order ${order.number} contains no items from your store.`,
      };
      await this.log(
        value,
        order.id,
        actor.id,
        'unauthorized_vendor',
        outcome.message,
      );
      return outcome;
    }

    if (order.collectedAt) {
      const outcome: ScanOutcome = {
        result: 'duplicate',
        message: `Order ${order.number} was already collected.`,
        order: this.shapeOrder(order),
      };
      await this.log(value, order.id, actor.id, 'duplicate', outcome.message);
      return outcome;
    }

    if (order.status !== 'paid' && order.status !== 'fulfilled') {
      const outcome: ScanOutcome = {
        result: 'invalid_state',
        message: `Order ${order.number} is "${order.status}" — only paid/fulfilled orders can be collected.`,
        order: this.shapeOrder(order),
      };
      await this.log(value, order.id, actor.id, 'invalid_state', outcome.message);
      return outcome;
    }

    return {
      result: 'success',
      message: 'Ready to mark as collected.',
      order: this.shapeOrder(order),
    };
  }

  /**
   * Mark the order as collected. Idempotency: if it's already collected,
   * we record a 'duplicate' log entry and return the duplicate outcome
   * without changing the order. Vendors are still constrained to their
   * own orders.
   */
  async markCollected(
    scannedValue: string,
    actor: { id: string; role: Role },
  ): Promise<ScanOutcome> {
    const validation = await this.scan(scannedValue, actor);
    if (validation.result !== 'success') {
      // scan() already logged duplicate / unauthorized / invalid; just return.
      return validation;
    }

    const order = await this.orders.findOne({
      where: { number: scannedValue.trim() },
    });
    if (!order) return validation;

    order.collectedAt = new Date();
    order.collectedById = actor.id;
    order.status = 'collected';
    const saved = await this.orders.save(order);

    await this.log(
      scannedValue.trim(),
      saved.id,
      actor.id,
      'success',
      `Marked as collected by ${actor.role}.`,
    );

    return {
      result: 'success',
      message: `Order ${saved.number} marked as collected.`,
      order: this.shapeOrder(saved),
    };
  }

  /**
   * Collection orders waiting to be picked up. Filters down to the
   * paid/fulfilled, not-yet-collected, fulfilment=collection set;
   * `mode` decides whether we want the in-window ("ready") or overdue
   * ("uncollected") subset, where the boundary is `thresholdDays`
   * since the order was placed.
   *
   * Vendors are scoped to orders containing at least one of their
   * items; admins/managers see everything.
   */
  async listCollectionOrders(opts: {
    actor: { id: string; role: Role };
    mode: 'ready' | 'uncollected';
    thresholdDays: number;
  }): Promise<Order[]> {
    const { actor, mode, thresholdDays } = opts;
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('items.vendor', 'itemVendor')
      .leftJoinAndSelect('o.customer', 'customer')
      .where("o.fulfilmentMethod = 'collection'")
      .andWhere("o.status IN ('paid', 'fulfilled')")
      .andWhere('o.collectedAt IS NULL');
    if (mode === 'ready') {
      qb.andWhere('o.createdAt > :cutoff', { cutoff });
    } else {
      qb.andWhere('o.createdAt <= :cutoff', { cutoff });
    }
    if (actor.role === Role.VENDOR) {
      // EXISTS subquery so an order with no items of theirs is excluded
      // entirely (otherwise the leftJoin would still return the row).
      qb.andWhere(
        `EXISTS (SELECT 1 FROM order_items oi WHERE oi."orderId" = o.id AND oi."vendorId" = :vid)`,
        { vid: actor.id },
      );
    }
    qb.orderBy('o.createdAt', mode === 'ready' ? 'DESC' : 'ASC');
    return qb.getMany();
  }

  /**
   * List collection logs visible to the actor. Vendors see only logs
   * tied to orders that contain their items (or that they themselves
   * scanned). Admins/managers see everything.
   */
  async listLogs(actor: { id: string; role: Role }, limit = 100) {
    if (actor.role === Role.ADMIN || actor.role === Role.MANAGER) {
      return this.logs.find({
        order: { createdAt: 'DESC' },
        take: limit,
      });
    }
    // Vendor: logs they scanned, OR logs on orders containing their items.
    const rows = await this.logs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.order', 'order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('log.scannedBy', 'scannedBy')
      .where('log.scannedById = :uid', { uid: actor.id })
      .orWhere('items.vendorId = :uid', { uid: actor.id })
      .orderBy('log.createdAt', 'DESC')
      .take(limit)
      .getMany();
    return rows;
  }

  private async log(
    scannedValue: string,
    orderId: string | undefined,
    scannedById: string,
    result: CollectionResult,
    notes: string,
  ) {
    const row = this.logs.create({
      scannedValue,
      orderId,
      scannedById,
      result,
      notes,
    });
    await this.logs.save(row);
  }

  private shapeOrder(order: Order): ScanOutcome['order'] {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      customerName: order.customer?.name,
      customerEmail: order.customer?.email,
      customerContact: (order.customer as any)?.contact,
      customerPpzId: order.customer?.ppzId,
      fulfilmentMethod: order.fulfilmentMethod,
      totalCents: order.totalCents,
      pointsTotal: order.pointsTotal,
      items: (order.items || []).map((i) => ({
        productName: i.productName,
        vendorId: i.vendorId,
        vendorName: i.vendor
          ? (i.vendor as any).vendorStoreName || i.vendor.name
          : undefined,
        quantity: i.quantity,
        pricingMode: i.pricingMode,
      })),
      collectedAt: order.collectedAt,
      collectedByName: order.collectedBy?.name,
      placedAt: order.createdAt,
    };
  }
}
