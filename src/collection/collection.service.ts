import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CollectionLog, CollectionResult } from './entities/collection-log.entity';
import { Role } from '../common/enums/role.enum';
import { PackingsService } from '../packings/packings.service';
import { Packing } from '../packings/entities/packing.entity';

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
    @InjectRepository(OrderItem) private orderItems: Repository<OrderItem>,
    @InjectRepository(CollectionLog) private logs: Repository<CollectionLog>,
    @InjectRepository(Packing) private packings: Repository<Packing>,
    private packingsService: PackingsService,
  ) {}

  /**
   * Validate a scanned QR / typed value against packing-based pickup
   * rules. The QR a customer shows at pickup encodes the packing.id,
   * so we resolve to a packing first; staff who type an order number
   * are routed to that order's packing as a fallback. Logs every
   * non-success outcome so admins have an audit trail of misfires.
   *
   * Vendors may only scan packings that contain at least one of their
   * items. Admins/managers may scan any packing.
   */
  async scan(
    scannedValue: string,
    actor: { id: string; role: Role },
  ): Promise<ScanOutcome> {
    const value = (scannedValue || '').trim();
    if (!value) {
      return { result: 'not_found', message: 'Empty scan' };
    }
    const packing = await this.packingsService.findByScannedValue(value);
    if (!packing) {
      return {
        result: 'not_found',
        message: `No packing or order matches "${value}".`,
      };
    }
    return this.evaluatePacking(packing, value, actor, { mark: false });
  }

  /**
   * Mark the packing as collected — and cascade to every order in it.
   * Vendors must have at least one of their items in the packing. We
   * piggy-back on scan() for validation so the logged outcomes are
   * identical to a "view-only" scan that hit the same rule.
   */
  async markCollected(
    scannedValue: string,
    actor: { id: string; role: Role },
  ): Promise<ScanOutcome> {
    const value = (scannedValue || '').trim();
    if (!value) {
      return { result: 'not_found', message: 'Empty scan' };
    }
    const packing = await this.packingsService.findByScannedValue(value);
    if (!packing) {
      return {
        result: 'not_found',
        message: `No packing or order matches "${value}".`,
      };
    }
    return this.evaluatePacking(packing, value, actor, { mark: true });
  }

  /**
   * Internal — share validation between scan and mark so the rules
   * never drift apart. When `mark` is true and the packing passes
   * every check, we cascade order.status='collected' onto every
   * constituent order via PackingsService.markCollected.
   */
  private async evaluatePacking(
    packing: Packing,
    scannedValue: string,
    actor: { id: string; role: Role },
    opts: { mark: boolean },
  ): Promise<ScanOutcome> {
    const items = await this.orderItems.find({
      where: { packingId: packing.id },
    });
    const orderIds = Array.from(new Set(items.map((i) => i.orderId)));
    const orders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];

    if (
      actor.role === Role.VENDOR &&
      !items.some((i) => i.vendorId === actor.id)
    ) {
      const outcome: ScanOutcome = {
        result: 'unauthorized_vendor',
        message: `This packing contains no items from your store.`,
      };
      await this.log(
        scannedValue,
        undefined,
        actor.id,
        'unauthorized_vendor',
        outcome.message,
      );
      return outcome;
    }

    if (packing.fulfilmentMethod && packing.fulfilmentMethod !== 'collection') {
      const outcome: ScanOutcome = {
        result: 'invalid_state',
        message: 'This bundle is for delivery, not self-collection.',
        order: this.shapePackingAsOrder(packing, orders, items),
      };
      await this.log(
        scannedValue,
        orders[0]?.id,
        actor.id,
        'invalid_state',
        outcome.message,
      );
      return outcome;
    }

    if (packing.status === 'collected') {
      const outcome: ScanOutcome = {
        result: 'duplicate',
        message: 'This bundle was already collected.',
        order: this.shapePackingAsOrder(packing, orders, items),
      };
      await this.log(
        scannedValue,
        orders[0]?.id,
        actor.id,
        'duplicate',
        outcome.message,
      );
      return outcome;
    }

    if (packing.status !== 'packed') {
      const outcome: ScanOutcome = {
        result: 'invalid_state',
        message:
          'This bundle is still being packed — finish packing it before collection.',
        order: this.shapePackingAsOrder(packing, orders, items),
      };
      await this.log(
        scannedValue,
        orders[0]?.id,
        actor.id,
        'invalid_state',
        outcome.message,
      );
      return outcome;
    }

    if (!opts.mark) {
      return {
        result: 'success',
        message: 'Ready to mark as collected.',
        order: this.shapePackingAsOrder(packing, orders, items),
      };
    }

    const { packing: saved } = await this.packingsService.markCollected(
      packing.id,
      actor,
    );
    // Reload orders post-cascade so the response shows status='collected'.
    const refreshedOrders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];
    await this.log(
      scannedValue,
      orders[0]?.id,
      actor.id,
      'success',
      `Bundle of ${orderIds.length} order(s) marked as collected by ${actor.role}.`,
    );
    return {
      result: 'success',
      message: `Bundle marked as collected (${refreshedOrders.length} order(s)).`,
      order: this.shapePackingAsOrder(saved, refreshedOrders, items),
    };
  }

  /**
   * Packings ready / overdue for collection. Replaces the prior
   * order-based listing — "Ready for collection" only shows packings
   * that have actually been marked PACKED (so unpacked items don't
   * surface), and the threshold splits packed-but-uncollected
   * packings into Ready vs. Uncollected based on packedAt.
   *
   * Vendors are scoped to packings containing at least one of their
   * items; admins/managers see everything.
   */
  async listCollectionPackings(opts: {
    actor: { id: string; role: Role };
    mode: 'ready' | 'uncollected';
    thresholdDays: number;
  }): Promise<Packing[]> {
    const { actor, mode, thresholdDays } = opts;
    // Self-heal so any paid order whose items lack a packingId gets
    // pulled into its customer's open bundle, and any packing whose
    // orders are all already collected gets flipped out of the
    // ready/uncollected list. Cheap when there's nothing to do.
    await this.packingsService.backfillUnpackedPaidOrders();
    await this.packingsService.healCollectedInOpenPackings();
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const qb = this.packings
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.customer', 'customer')
      .where("p.fulfilmentMethod = 'collection'")
      .andWhere("p.status = 'packed'");

    if (mode === 'ready') {
      qb.andWhere('(p.packedAt IS NULL OR p.packedAt > :cutoff)', { cutoff });
    } else {
      qb.andWhere('p.packedAt <= :cutoff', { cutoff });
    }
    if (actor.role === Role.VENDOR) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM order_items oi WHERE oi."packingId" = p.id AND oi."vendorId" = :vid)`,
        { vid: actor.id },
      );
    }
    qb.orderBy('p.packedAt', mode === 'ready' ? 'DESC' : 'ASC');
    return qb.getMany();
  }

  /**
   * Hydrate a list of packings with the orders + items they cover.
   * Done in two extra queries so the page can iterate `packing.orders`
   * directly instead of calling back into the service per row.
   */
  async expandPackings(packings: Packing[]): Promise<
    Array<Packing & { _orders: Order[]; _items: OrderItem[] }>
  > {
    if (!packings.length) return [];
    const ids = packings.map((p) => p.id);
    const items = await this.orderItems.find({
      where: { packingId: In(ids) },
    });
    const orderIds = Array.from(new Set(items.map((i) => i.orderId)));
    const orders = orderIds.length
      ? await this.orders.find({ where: { id: In(orderIds) } })
      : [];
    return packings.map((p) => {
      const ownItems = items.filter((i) => i.packingId === p.id);
      const ownOrderIds = new Set(ownItems.map((i) => i.orderId));
      const ownOrders = orders.filter((o) => ownOrderIds.has(o.id));
      return Object.assign(p, { _orders: ownOrders, _items: ownItems });
    });
  }

  /**
   * List collection logs visible to the actor. Vendors see only logs
   * tied to orders that contain their items (or that they themselves
   * scanned). Admins/managers see everything.
   *
   * Each log is enriched with the bundle of order numbers covered by
   * the same packing, so the Logs view can show every order that one
   * scan collected — not just the single orderId the row carries.
   */
  async listLogs(actor: { id: string; role: Role }, limit = 100) {
    let rows: CollectionLog[];
    if (actor.role === Role.ADMIN || actor.role === Role.MANAGER) {
      rows = await this.logs.find({
        order: { createdAt: 'DESC' },
        take: limit,
      });
    } else {
      // Vendor: logs they scanned, OR logs on orders containing their items.
      rows = await this.logs
        .createQueryBuilder('log')
        .leftJoinAndSelect('log.order', 'order')
        .leftJoinAndSelect('order.items', 'items')
        .leftJoinAndSelect('log.scannedBy', 'scannedBy')
        .where('log.scannedById = :uid', { uid: actor.id })
        .orWhere('items.vendorId = :uid', { uid: actor.id })
        .orderBy('log.createdAt', 'DESC')
        .take(limit)
        .getMany();
    }

    const orderIds = rows
      .map((r) => r.orderId)
      .filter((id): id is string => !!id);
    const bundleByLogOrderId = new Map<string, string[]>();
    if (orderIds.length) {
      const items = await this.orderItems
        .createQueryBuilder('item')
        .select(['item.orderId', 'item.packingId'])
        .where('item.orderId IN (:...ids)', { ids: orderIds })
        .andWhere('item.packingId IS NOT NULL')
        .getMany();
      const orderToPacking = new Map<string, string>();
      for (const it of items) {
        if (it.packingId && !orderToPacking.has(it.orderId)) {
          orderToPacking.set(it.orderId, it.packingId);
        }
      }
      const packingIds = Array.from(new Set(orderToPacking.values()));
      if (packingIds.length) {
        const sibling = await this.orderItems
          .createQueryBuilder('item')
          .select(['item.orderId', 'item.packingId'])
          .where('item.packingId IN (:...pids)', { pids: packingIds })
          .getMany();
        const packingOrderIds = new Map<string, Set<string>>();
        for (const it of sibling) {
          if (!it.packingId) continue;
          const set = packingOrderIds.get(it.packingId) || new Set<string>();
          set.add(it.orderId);
          packingOrderIds.set(it.packingId, set);
        }
        const allBundleOrderIds = new Set<string>();
        for (const set of packingOrderIds.values()) {
          for (const id of set) allBundleOrderIds.add(id);
        }
        const orderRecords = allBundleOrderIds.size
          ? await this.orders.find({
              where: { id: In(Array.from(allBundleOrderIds)) },
            })
          : [];
        const numberById = new Map(orderRecords.map((o) => [o.id, o.number]));
        for (const [orderId, packingId] of orderToPacking) {
          const ids = Array.from(packingOrderIds.get(packingId) || []);
          const numbers = ids
            .map((id) => numberById.get(id))
            .filter((n): n is string => !!n)
            .sort();
          bundleByLogOrderId.set(orderId, numbers);
        }
      }
    }

    return rows.map((r) =>
      Object.assign(r, {
        bundleOrderNumbers: r.orderId
          ? bundleByLogOrderId.get(r.orderId) || (r.order ? [r.order.number] : [])
          : [],
      }),
    );
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

  /**
   * Render a packing as the existing per-order ScanOutcome shape so
   * the scanner UI doesn't need to know about packings. The "number"
   * lists every order in the bundle (newline-separated) and the items
   * array is flattened across them; totals are summed. The packing.id
   * is exposed via the `id` field so the action button can pass it
   * straight back to /api/collection/mark for the cascade.
   */
  private shapePackingAsOrder(
    packing: Packing,
    orders: Order[],
    items: OrderItem[],
  ): ScanOutcome['order'] {
    const totalCents = orders.reduce((s, o) => s + (o.totalCents || 0), 0);
    const pointsTotal = orders.reduce((s, o) => s + (o.pointsTotal || 0), 0);
    const earliest = orders.reduce<Date | undefined>(
      (acc, o) =>
        !acc || (o.createdAt && o.createdAt < acc) ? o.createdAt : acc,
      undefined,
    );
    const numbers = orders.map((o) => o.number).join('\n');
    return {
      id: packing.id,
      number: numbers || `Bundle ${packing.id.slice(0, 8)}`,
      status:
        packing.status === 'collected'
          ? 'collected'
          : packing.status === 'packed'
            ? 'paid'
            : packing.status,
      customerName: packing.customer?.name,
      customerEmail: packing.customer?.email,
      customerContact: (packing.customer as any)?.contact,
      customerPpzId: packing.customer?.ppzId,
      fulfilmentMethod: packing.fulfilmentMethod || 'collection',
      totalCents,
      pointsTotal,
      items: items.map((i) => ({
        productName: i.productName,
        vendorId: i.vendorId,
        vendorName: i.vendor
          ? (i.vendor as any).vendorStoreName || i.vendor.name
          : undefined,
        quantity: i.quantity,
        pricingMode: i.pricingMode,
      })),
      collectedAt: packing.collectedAt,
      collectedByName: packing.collectedBy?.name,
      placedAt: earliest || packing.createdAt,
    };
  }
}
