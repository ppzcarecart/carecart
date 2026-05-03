import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Cart } from './entities/cart.entity';
import { CartItem, PricingMode } from './entities/cart-item.entity';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { FulfilmentService, CollectionPoint } from '../fulfilment/fulfilment.service';
import { FulfilmentMethod } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private carts: Repository<Cart>,
    @InjectRepository(CartItem) private items: Repository<CartItem>,
    private products: ProductsService,
    private users: UsersService,
    private fulfilment: FulfilmentService,
    private settings: SettingsService,
  ) {}

  /**
   * Resolve the per-unit split for one cart line. For 'price' mode the
   * customer pays full cash and zero points. For 'points' mode the
   * customer redeems the configured points to OFFSET the PPZ price:
   * the points convert to cents at the global pointsPerDollar rate, the
   * offset is capped at the product's PPZ price (no over-charging
   * points) and the buyer covers any leftover cash.
   *
   *   ppzPrice $20, pointsPrice 500, ppd 50
   *     → discount $10, customer pays $10 cash + 500 pts
   *
   *   ppzPrice $20, pointsPrice 1000, ppd 50
   *     → discount $20, customer pays $0 + 1000 pts
   *
   *   ppzPrice $20, pointsPrice 1500, ppd 50
   *     → discount capped at $20, customer pays $0 + 1000 pts
   *       (admin's surplus 500 pts is not charged)
   */
  private splitUnit(opts: {
    pricingMode: PricingMode;
    baseCashCents: number;
    pointsConfigured: number | null | undefined;
  }): { unitCashCents: number; unitPoints: number } {
    const { pricingMode, baseCashCents } = opts;
    const pointsConfigured = opts.pointsConfigured ?? 0;
    if (pricingMode !== 'points' || pointsConfigured <= 0) {
      return { unitCashCents: baseCashCents, unitPoints: 0 };
    }
    const ppd = this.settings.pointsPerDollar();
    if (ppd <= 0) {
      return { unitCashCents: baseCashCents, unitPoints: 0 };
    }
    const pointsValueCents = Math.round((pointsConfigured * 100) / ppd);
    const discountCents = Math.min(pointsValueCents, baseCashCents);
    const unitCashCents = baseCashCents - discountCents;
    const unitPoints = Math.round((discountCents * ppd) / 100);
    return { unitCashCents, unitPoints };
  }

  private async isPpzMember(userId: string) {
    const u = await this.users.findById(userId);
    return !!u?.ppzId;
  }

  async getOrCreate(userId: string): Promise<Cart> {
    let cart = await this.carts.findOne({ where: { userId } });
    if (!cart) {
      cart = this.carts.create({ userId, items: [] });
      cart = await this.carts.save(cart);
    }
    return cart;
  }

  async addItem(
    userId: string,
    productId: string,
    variantId: string | undefined,
    quantity: number,
    pricingMode: PricingMode,
  ) {
    if (quantity < 1) throw new BadRequestException('quantity must be >= 1');
    const product = await this.products.findById(productId);
    if (!product || !product.active) throw new NotFoundException('Product not available');

    const variant = variantId
      ? product.variants?.find((v) => v.id === variantId)
      : undefined;

    if (pricingMode === 'points') {
      const isMember = await this.isPpzMember(userId);
      if (!isMember) {
        throw new BadRequestException('Only PPZ members can pay with points');
      }
      const { pointsPrice } = this.products.resolvePricing(product, variant, true);
      if (pointsPrice === null || pointsPrice === undefined) {
        throw new BadRequestException('This item cannot be purchased with points');
      }
    }

    const cart = await this.getOrCreate(userId);
    const existing = cart.items.find(
      (i) => i.productId === productId && (i.variantId ?? null) === (variantId ?? null) && i.pricingMode === pricingMode,
    );
    if (existing) {
      existing.quantity += quantity;
      await this.items.save(existing);
    } else {
      const item = this.items.create({
        cartId: cart.id,
        productId,
        variantId,
        quantity,
        pricingMode,
      });
      await this.items.save(item);
    }
    return this.getOrCreate(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    if (quantity < 0) throw new BadRequestException('quantity must be >= 0');
    const cart = await this.getOrCreate(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Cart item not found');
    if (quantity === 0) {
      await this.items.remove(item);
    } else {
      item.quantity = quantity;
      await this.items.save(item);
    }
    return this.getOrCreate(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getOrCreate(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) return cart;
    await this.items.remove(item);
    return this.getOrCreate(userId);
  }

  async clear(userId: string) {
    const cart = await this.getOrCreate(userId);
    if (cart.items.length) await this.items.remove(cart.items);
    return this.getOrCreate(userId);
  }

  async summary(
    userId: string,
    fulfilmentMethod: FulfilmentMethod = 'delivery',
  ) {
    const cart = await this.getOrCreate(userId);
    const isMember = await this.isPpzMember(userId);

    let subtotalCents = 0;
    let pointsTotal = 0;
    let deliveryFeeCents = 0;

    // Resolve pricing first (sync), then fulfilment (async). For
    // points-mode lines the split is hybrid: configured points convert
    // to a cents discount via pointsPerDollar, capped at product value;
    // the buyer covers the leftover in cash. See splitUnit() above.
    const baseLines = cart.items.map((item) => {
      const variant = item.variant;
      const product = item.product;
      const pricing = this.products.resolvePricing(product, variant, isMember);
      const { unitCashCents, unitPoints } = this.splitUnit({
        pricingMode: item.pricingMode,
        baseCashCents: pricing.priceCents,
        pointsConfigured: pricing.pointsPrice,
      });
      const lineCents = unitCashCents * item.quantity;
      const linePoints = unitPoints * item.quantity;
      subtotalCents += lineCents;
      pointsTotal += linePoints;
      return {
        item,
        product,
        priceCents: pricing.priceCents,
        pointsPrice: pricing.pointsPrice,
        normalPriceCents: pricing.normalPriceCents,
        isPpzPrice: pricing.isPpzPrice,
        unitCashCents,
        unitPoints,
        lineCents,
        linePoints,
      };
    });

    // Any line that's flagged collectionOnly forces the cart into
    // self-collection — Delivery becomes unavailable regardless of the
    // global delivery setting. The forced flag flows to the UI so it
    // can explain *why* delivery is disabled.
    const collectionOnlyForced = baseLines.some(
      (l) => l.product?.collectionOnly,
    );
    const deliveryEnabled = this.fulfilment.isDeliveryEnabled();
    const deliveryAvailable = deliveryEnabled && !collectionOnlyForced;
    const isDelivery =
      fulfilmentMethod === 'delivery' && deliveryAvailable;

    const lines: any[] = [];
    // Group collection points by resolved identity, not by vendor —
    // per-product collectionSource means two products from the same
    // vendor can land at different pickup locations (e.g. one at PPZ,
    // one at the vendor storefront).
    const collectionByKey = new Map<string, CollectionPoint>();

    for (const l of baseLines) {
      let lineDelivery = 0;
      // Cash-paid lines incur delivery fees; points-only lines don't (the
      // shop owner can change this later if they want a different policy).
      if (isDelivery && l.item.pricingMode === 'price') {
        lineDelivery = await this.fulfilment.resolveDeliveryFee(l.product);
        deliveryFeeCents += lineDelivery;
      }
      lines.push({ ...l, deliveryFeeCents: lineDelivery });

      if (!isDelivery) {
        const cp = await this.fulfilment.resolveCollectionPoint(
          l.product.vendorId,
          l.product,
        );
        const key = cp.source === 'admin' ? 'admin' : `vendor:${cp.vendorId}`;
        if (!collectionByKey.has(key)) collectionByKey.set(key, cp);
      }
    }

    const collectionPoints = Array.from(collectionByKey.values());
    const totalCents = subtotalCents + deliveryFeeCents;

    return {
      cart,
      lines,
      subtotalCents,
      deliveryFeeCents,
      totalCents,
      pointsTotal,
      isPpzMember: isMember,
      fulfilmentMethod: isDelivery ? 'delivery' : 'collection',
      deliveryEnabled,
      deliveryAvailable,
      collectionOnlyForced,
      collectionPoints,
    };
  }
}
