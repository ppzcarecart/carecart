import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, MoreThanOrEqual, Not, Repository } from 'typeorm';

import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductImage } from './entities/product-image.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertVariantDto } from './dto/upsert-variant.dto';
import { Role } from '../common/enums/role.enum';
import { slugify } from '../common/utils/slugify';
import { SettingsService } from '../settings/settings.service';

export interface ActorContext {
  id: string;
  role: Role;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(ProductVariant) private variants: Repository<ProductVariant>,
    @InjectRepository(ProductImage) private images: Repository<ProductImage>,
    private settings: SettingsService,
  ) {}

  /**
   * Auto-derived points cost: ceil(priceDollars) * pointsPerDollar.
   * "$0.20 → 50 pts" because cents round up to the next dollar before
   * applying the rate.
   */
  computeAutoPoints(priceCents: number): number {
    const dollars = Math.ceil(priceCents / 100);
    return dollars * this.settings.pointsPerDollar();
  }

  /**
   * Decorate fetched products with the resolved cash + points price for
   * the current viewer (PPZ member or not). Templates read these
   * pre-computed fields instead of reaching back into the manual
   * pointsPrice on the entity. Includes the hybrid redeem preview
   * (cash leftover + points actually charged after the offset cap) so
   * cards and product pages render "or N pts at $X" identically.
   */
  enrichForView(products: Product[], isPpzMember: boolean): Product[] {
    const ppd = this.settings.pointsPerDollar();
    for (const p of products) {
      const r = this.resolvePricing(p, undefined, isPpzMember);
      (p as any).effectiveCashCents = r.priceCents;
      (p as any).effectivePointsPrice = r.pointsPrice;
      (p as any).isPpzPriceActive = r.isPpzPrice;

      let redeemCashCents = r.priceCents;
      let redeemPoints = 0;
      if (isPpzMember && r.pointsPrice && ppd > 0) {
        if (r.priceCents === 0) {
          // Redeem-only listing: cash price is $0, so the configured
          // pointsPrice IS the cost — there's nothing to "discount"
          // against. Without this branch the offset math caps the
          // discount at $0 and the customer would see/pay 0 pts.
          redeemPoints = r.pointsPrice;
          redeemCashCents = 0;
        } else {
          const pointsValueCents = Math.round((r.pointsPrice * 100) / ppd);
          const discountCents = Math.min(pointsValueCents, r.priceCents);
          redeemCashCents = r.priceCents - discountCents;
          redeemPoints = Math.round((discountCents * ppd) / 100);
        }
      }
      (p as any).effectiveRedeemCashCents = redeemCashCents;
      (p as any).effectiveRedeemPoints = redeemPoints;
    }
    return products;
  }

  async list(opts: {
    q?: string;
    categoryId?: string;
    vendorId?: string;
    activeOnly?: boolean;
    featuredOnly?: boolean;
    excludeFeatured?: boolean;
    newSince?: Date;
    limit?: number;
    /** When true, return ONLY disabled products (admin's Disabled view). */
    disabledOnly?: boolean;
  }) {
    const where: any = {};
    if (opts.activeOnly) where.active = true;
    if (opts.featuredOnly) where.featured = true;
    if (opts.excludeFeatured) where.featured = Not(true);
    if (opts.categoryId) where.categoryId = opts.categoryId;
    if (opts.vendorId) where.vendorId = opts.vendorId;
    if (opts.q) where.name = ILike(`%${opts.q}%`);
    if (opts.newSince) where.createdAt = MoreThanOrEqual(opts.newSince);
    // Disabled products (vendor was deactivated) are taken off-shelf
    // everywhere by default and only surface in the dedicated
    // /admin/products/disabled view via disabledOnly=true.
    if (opts.disabledOnly) {
      where.disabled = true;
    } else {
      where.disabled = false;
    }
    return this.products.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
      take: opts.limit,
    });
  }

  /** Toggle featured flag. Admin/Manager only. Caps total featured at 8. */
  async setFeatured(id: string, value: boolean): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    if (value && !product.featured) {
      const count = await this.products.count({ where: { featured: true } });
      if (count >= 8) {
        throw new BadRequestException(
          'You already have 8 featured products. Unfeature one first.',
        );
      }
    }
    product.featured = value;
    return this.products.save(product);
  }

  findById(id: string) {
    // Admin/edit paths use this — keep disabled products visible so
    // staff can still review or delete them after a vendor was
    // deactivated.
    return this.products.findOne({ where: { id } });
  }

  findBySlug(slug: string) {
    // Storefront product detail. Hide disabled products (vendor was
    // deactivated) — show as 404 to the customer.
    return this.products.findOne({ where: { slug, disabled: false } });
  }

  private assertCanEdit(product: Product, actor: ActorContext) {
    if (actor.role === Role.ADMIN || actor.role === Role.MANAGER) return;
    if (actor.role === Role.VENDOR && product.vendorId === actor.id) return;
    throw new ForbiddenException('You can only edit your own products');
  }

  async create(dto: CreateProductDto, actor: ActorContext): Promise<Product> {
    if (dto.priceCents == null || dto.priceCents < 0) {
      throw new BadRequestException('priceCents is required and must be >= 0');
    }

    let vendorId: string;
    if (actor.role === Role.VENDOR) {
      vendorId = actor.id; // vendors can only create under their own id
    } else if (actor.role === Role.ADMIN || actor.role === Role.MANAGER) {
      if (!dto.vendorId) throw new BadRequestException('vendorId is required for admin/manager');
      vendorId = dto.vendorId;
    } else {
      throw new ForbiddenException('Not allowed to create products');
    }

    const slug = (dto.slug || slugify(dto.name)).toLowerCase();
    const existing = await this.products.findOne({ where: { slug } });
    const finalSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug;

    const product = this.products.create({
      name: dto.name,
      slug: finalSlug,
      description: dto.description,
      priceCents: dto.priceCents,
      ppzPriceCents: dto.ppzPriceCents ?? null,
      currency: dto.currency || 'SGD',
      pointsPrice: dto.pointsPrice ?? null,
      allowPointsRedemption: dto.allowPointsRedemption ?? false,
      deliveryFeeCentsOverride: dto.deliveryFeeCentsOverride ?? null,
      collectionOnly: dto.collectionOnly ?? false,
      collectionSource: dto.collectionSource ?? null,
      stock: dto.stock ?? 0,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
      redeemLimitPerCustomer: dto.redeemLimitPerCustomer ?? null,
      redeemLimitWindowDays: dto.redeemLimitWindowDays ?? null,
      vendorId,
      categoryId: dto.categoryId,
      variants: (dto.variants || []).map((v) =>
        this.variants.create({
          name: v.name,
          sku: v.sku,
          priceCentsOverride: v.priceCentsOverride,
          ppzPriceCentsOverride: v.ppzPriceCentsOverride,
          pointsPriceOverride: v.pointsPriceOverride,
          stock: v.stock ?? 0,
          active: v.active ?? true,
          imageUrl: v.imageUrl ?? null,
          description: v.description ?? null,
        }),
      ),
      images: (dto.imageUrls || []).map((url, i) =>
        this.images.create({ url, position: i }),
      ),
    });

    return this.products.save(product);
  }

  async update(id: string, dto: UpdateProductDto, actor: ActorContext) {
    const product = await this.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.slug !== undefined) {
      product.slug = (dto.slug || slugify(product.name)).toLowerCase();
    }
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.priceCents !== undefined) {
      if (dto.priceCents == null || dto.priceCents < 0) {
        throw new BadRequestException('priceCents must be >= 0');
      }
      product.priceCents = dto.priceCents;
    }
    if (dto.currency !== undefined) product.currency = dto.currency;
    if (dto.ppzPriceCents !== undefined) product.ppzPriceCents = dto.ppzPriceCents;
    if (dto.pointsPrice !== undefined) product.pointsPrice = dto.pointsPrice;
    if (dto.allowPointsRedemption !== undefined) {
      product.allowPointsRedemption = !!dto.allowPointsRedemption;
    }
    if (dto.deliveryFeeCentsOverride !== undefined) {
      product.deliveryFeeCentsOverride = dto.deliveryFeeCentsOverride as any;
    }
    if (dto.collectionOnly !== undefined) {
      product.collectionOnly = !!dto.collectionOnly;
    }
    if (dto.collectionSource !== undefined) {
      // explicit null clears the per-product override and falls back
      // to the vendor-level useOwnCollectionLocation toggle.
      product.collectionSource = dto.collectionSource ?? null;
    }
    if (dto.stock !== undefined) product.stock = dto.stock;
    if (dto.active !== undefined) product.active = dto.active;
    if (dto.sortOrder !== undefined) product.sortOrder = dto.sortOrder;
    if (dto.redeemLimitPerCustomer !== undefined) {
      product.redeemLimitPerCustomer = dto.redeemLimitPerCustomer;
    }
    if (dto.redeemLimitWindowDays !== undefined) {
      product.redeemLimitWindowDays = dto.redeemLimitWindowDays;
    }
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;

    if (dto.imageUrls) {
      // replace all images
      await this.images.delete({ productId: product.id });
      product.images = dto.imageUrls.map((url, i) =>
        this.images.create({ url, position: i, productId: product.id }),
      );
    }

    return this.products.save(product);
  }

  async remove(id: string, actor: ActorContext) {
    const product = await this.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    await this.products.remove(product);
    return { ok: true };
  }

  // Variant management
  async upsertVariant(productId: string, dto: UpsertVariantDto, actor: ActorContext) {
    const product = await this.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    let variant: ProductVariant;
    if (dto.id) {
      variant = await this.variants.findOne({ where: { id: dto.id, productId } });
      if (!variant) throw new NotFoundException('Variant not found');
      Object.assign(variant, dto);
    } else {
      variant = this.variants.create({
        productId,
        name: dto.name,
        sku: dto.sku,
        priceCentsOverride: dto.priceCentsOverride,
        ppzPriceCentsOverride: dto.ppzPriceCentsOverride,
        pointsPriceOverride: dto.pointsPriceOverride,
        stock: dto.stock ?? 0,
        active: dto.active ?? true,
        imageUrl: dto.imageUrl ?? null,
        description: dto.description ?? null,
      });
    }
    return this.variants.save(variant);
  }

  async removeVariant(productId: string, variantId: string, actor: ActorContext) {
    const product = await this.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    const variant = await this.variants.findOne({ where: { id: variantId, productId } });
    if (!variant) throw new NotFoundException('Variant not found');
    await this.variants.remove(variant);
    return { ok: true };
  }

  // Image management — append/remove individual images, capped at 8 per product
  async addImage(productId: string, url: string, actor: ActorContext) {
    if (!url) throw new BadRequestException('url is required');
    const product = await this.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    const count = await this.images.count({ where: { productId } });
    if (count >= 8) {
      throw new BadRequestException('Maximum 8 images per product');
    }
    const img = this.images.create({ productId, url, position: count });
    return this.images.save(img);
  }

  async removeImage(productId: string, imageId: string, actor: ActorContext) {
    const product = await this.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    const img = await this.images.findOne({ where: { id: imageId, productId } });
    if (!img) throw new NotFoundException('Image not found');
    await this.images.remove(img);
    return { ok: true };
  }

  async updateStock(productId: string, variantId: string | undefined, stock: number, actor: ActorContext) {
    const product = await this.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    this.assertCanEdit(product, actor);
    if (variantId) {
      const v = await this.variants.findOne({ where: { id: variantId, productId } });
      if (!v) throw new NotFoundException('Variant not found');
      v.stock = stock;
      return this.variants.save(v);
    }
    product.stock = stock;
    return this.products.save(product);
  }

  /**
   * Resolves the effective price/points for an order line. When
   * `isPpzMember` is true and the product (or variant) has a PPZ price
   * defined, that value replaces the normal cash price. Points price is
   * only ever returned for PPZ members — non-members can't redeem.
   *
   * The `priceCents` field in the result is what the buyer pays in cash
   * for this line, so the rest of the cart/order code doesn't need to
   * branch on member status.
   */
  resolvePricing(
    product: Product,
    variant?: ProductVariant,
    isPpzMember = false,
  ) {
    const normalCents = variant?.priceCentsOverride ?? product.priceCents;
    const ppzCents =
      variant?.ppzPriceCentsOverride ?? product.ppzPriceCents ?? null;

    const usePpz = isPpzMember && ppzCents != null;
    const buyerCashCents = usePpz ? ppzCents : normalCents;

    let memberPoints: number | null;
    if (product.allowPointsRedemption) {
      // Auto-calculated from the buyer-applicable cash price.
      memberPoints = this.computeAutoPoints(buyerCashCents);
    } else {
      memberPoints =
        variant?.pointsPriceOverride !== undefined &&
        variant?.pointsPriceOverride !== null
          ? variant.pointsPriceOverride
          : product.pointsPrice ?? null;
    }

    return {
      priceCents: buyerCashCents,
      normalPriceCents: normalCents,
      ppzPriceCents: ppzCents,
      pointsPrice: isPpzMember ? memberPoints : null,
      isPpzPrice: usePpz,
      allowPointsRedemption: !!product.allowPointsRedemption,
    };
  }
}
