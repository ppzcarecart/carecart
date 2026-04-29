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

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private carts: Repository<Cart>,
    @InjectRepository(CartItem) private items: Repository<CartItem>,
    private products: ProductsService,
  ) {}

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
      const { pointsPrice } = this.products.resolvePricing(product, variant);
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

  async summary(userId: string) {
    const cart = await this.getOrCreate(userId);
    let subtotalCents = 0;
    let pointsTotal = 0;
    const lines = cart.items.map((item) => {
      const variant = item.variant;
      const product = item.product;
      const { priceCents, pointsPrice } = this.products.resolvePricing(product, variant);
      const lineCents = item.pricingMode === 'price' ? priceCents * item.quantity : 0;
      const linePoints =
        item.pricingMode === 'points' && pointsPrice != null ? pointsPrice * item.quantity : 0;
      subtotalCents += lineCents;
      pointsTotal += linePoints;
      return {
        item,
        priceCents,
        pointsPrice,
        lineCents,
        linePoints,
      };
    });
    return { cart, lines, subtotalCents, pointsTotal };
  }
}
