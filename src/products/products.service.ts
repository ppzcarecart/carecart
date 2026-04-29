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
  ) {}

  async list(opts: {
    q?: string;
    categoryId?: string;
    vendorId?: string;
    activeOnly?: boolean;
    featuredOnly?: boolean;
    excludeFeatured?: boolean;
    newSince?: Date;
    limit?: number;
  }) {
    const where: any = {};
    if (opts.activeOnly) where.active = true;
    if (opts.featuredOnly) where.featured = true;
    if (opts.excludeFeatured) where.featured = Not(true);
    if (opts.categoryId) where.categoryId = opts.categoryId;
    if (opts.vendorId) where.vendorId = opts.vendorId;
    if (opts.q) where.name = ILike(`%${opts.q}%`);
    if (opts.newSince) where.createdAt = MoreThanOrEqual(opts.newSince);
    return this.products.find({
      where,
      order: { createdAt: 'DESC' },
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
    return this.products.findOne({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.products.findOne({ where: { slug } });
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
      currency: dto.currency || 'SGD',
      pointsPrice: dto.pointsPrice ?? null,
      stock: dto.stock ?? 0,
      active: dto.active ?? true,
      vendorId,
      categoryId: dto.categoryId,
      variants: (dto.variants || []).map((v) =>
        this.variants.create({
          name: v.name,
          sku: v.sku,
          priceCentsOverride: v.priceCentsOverride,
          pointsPriceOverride: v.pointsPriceOverride,
          stock: v.stock ?? 0,
          active: v.active ?? true,
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
    if (dto.pointsPrice !== undefined) product.pointsPrice = dto.pointsPrice;
    if (dto.stock !== undefined) product.stock = dto.stock;
    if (dto.active !== undefined) product.active = dto.active;
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
        pointsPriceOverride: dto.pointsPriceOverride,
        stock: dto.stock ?? 0,
        active: dto.active ?? true,
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

  // Resolves the effective price/points for an order line
  resolvePricing(product: Product, variant?: ProductVariant) {
    const priceCents = variant?.priceCentsOverride ?? product.priceCents;
    const pointsPrice =
      variant?.pointsPriceOverride !== undefined && variant?.pointsPriceOverride !== null
        ? variant.pointsPriceOverride
        : product.pointsPrice ?? null;
    return { priceCents, pointsPrice };
  }
}
