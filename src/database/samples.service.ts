import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { User } from '../users/entities/user.entity';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { ProductImage } from '../products/entities/product-image.entity';
import { Role } from '../common/enums/role.enum';

interface VariantSpec {
  name: string;
  stock: number;
  priceCentsOverride?: number;
  pointsPriceOverride?: number;
}

interface ProductSpec {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  pointsPrice?: number;
  stock: number;
  categorySlug: string;
  variants?: VariantSpec[];
  imageUrls?: string[];
  featured?: boolean;
}

/**
 * Idempotent demo data seeder. Runs on boot only when SEED_SAMPLES=true.
 * - Creates a demo vendor (demo@carecart.local / Demo!123)
 * - Creates four categories
 * - Creates eight products with variants
 *
 * Each entity is only inserted if not already present, so it is safe to
 * leave SEED_SAMPLES=true permanently.
 */
@Injectable()
export class SamplesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SamplesService.name);

  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(ProductVariant) private variants: Repository<ProductVariant>,
    @InjectRepository(ProductImage) private images: Repository<ProductImage>,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get<string>('SEED_SAMPLES') !== 'true') return;

    const vendor = await this.ensureVendor();
    const cats = await this.ensureCategories();
    const inserted = await this.ensureProducts(vendor, cats);
    this.logger.log(
      `Sample seeder finished — vendor=${vendor.email}, categories=${Object.keys(cats).length}, new products=${inserted}`,
    );
  }

  private async ensureVendor(): Promise<User> {
    const email = 'demo@carecart.local';
    let vendor = await this.users.findOne({ where: { email } });
    if (vendor) return vendor;
    vendor = this.users.create({
      email,
      passwordHash: await bcrypt.hash('Demo!123', 10),
      name: 'Demo Vendor',
      vendorStoreName: 'Carecart Demo Store',
      vendorBio: 'Sample vendor used to populate the demo catalogue.',
      role: Role.VENDOR,
    });
    return this.users.save(vendor);
  }

  private async ensureCategories(): Promise<Record<string, Category>> {
    const data = [
      { slug: 'apparel', name: 'Apparel', description: 'Clothing and tees' },
      { slug: 'accessories', name: 'Accessories', description: 'Bags, caps and more' },
      { slug: 'wellness', name: 'Wellness', description: 'Supplements and skincare' },
      { slug: 'home', name: 'Home', description: 'Lifestyle and home goods' },
    ];
    const out: Record<string, Category> = {};
    for (const c of data) {
      let cat = await this.categories.findOne({ where: { slug: c.slug } });
      if (!cat) {
        cat = await this.categories.save(this.categories.create(c));
      }
      out[c.slug] = cat;
    }
    return out;
  }

  private async ensureProducts(
    vendor: User,
    cats: Record<string, Category>,
  ): Promise<number> {
    // Image URLs use Unsplash's public CDN. The placeholder partial in the
    // views falls back to a gradient if any URL fails to load.
    const u = (id: string) =>
      `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

    const specs: ProductSpec[] = [
      {
        slug: 'carecart-classic-tee',
        name: 'Carecart Classic Tee',
        description: 'Soft 100% cotton tee with the carecart logo. Pre-shrunk.',
        priceCents: 1990,
        pointsPrice: 200,
        stock: 0,
        categorySlug: 'apparel',
        featured: true,
        imageUrls: [u('photo-1521572163474-6864f9cf17ab')],
        variants: [
          { name: 'Size: S / Color: Black', stock: 20 },
          { name: 'Size: M / Color: Black', stock: 25 },
          { name: 'Size: L / Color: Black', stock: 25 },
          { name: 'Size: XL / Color: Black', stock: 15 },
          { name: 'Size: M / Color: White', stock: 30 },
          { name: 'Size: L / Color: White', stock: 25 },
        ],
      },
      {
        slug: 'comfort-hoodie',
        name: 'Comfort Hoodie',
        description: 'Heavyweight fleece hoodie. Kangaroo pocket. Ribbed cuffs.',
        priceCents: 4990,
        pointsPrice: 500,
        stock: 0,
        categorySlug: 'apparel',
        featured: true,
        imageUrls: [u('photo-1556821840-3a63f95609a7')],
        variants: [
          { name: 'Size: S', stock: 10 },
          { name: 'Size: M', stock: 15 },
          { name: 'Size: L', stock: 15 },
          { name: 'Size: XL', stock: 10, priceCentsOverride: 5290 },
        ],
      },
      {
        slug: 'canvas-tote-bag',
        name: 'Canvas Tote Bag',
        description: 'Reusable 12oz canvas tote with reinforced handles.',
        priceCents: 1490,
        pointsPrice: 150,
        stock: 0,
        categorySlug: 'accessories',
        featured: true,
        imageUrls: [u('photo-1601924994987-69e26d50dc26')],
        variants: [
          { name: 'Color: Natural', stock: 40 },
          { name: 'Color: Black', stock: 30 },
        ],
      },
      {
        slug: 'classic-snapback',
        name: 'Classic Snapback Cap',
        description: 'Adjustable structured 6-panel cap. One size fits most.',
        priceCents: 1900,
        pointsPrice: 190,
        stock: 35,
        categorySlug: 'accessories',
        imageUrls: [u('photo-1588850561407-ed78c282e89b')],
      },
      {
        slug: 'multivitamin-daily',
        name: 'Multivitamin Daily',
        description: 'Once-a-day multivitamin to support general wellbeing.',
        priceCents: 2990,
        pointsPrice: 300,
        stock: 0,
        categorySlug: 'wellness',
        featured: true,
        imageUrls: [u('photo-1607619056574-7b8d3ee536b2')],
        variants: [
          { name: '30 tablets', stock: 50 },
          { name: '60 tablets', stock: 40, priceCentsOverride: 4990, pointsPriceOverride: 500 },
          { name: '90 tablets', stock: 30, priceCentsOverride: 6990, pointsPriceOverride: 700 },
        ],
      },
      {
        slug: 'hydrating-moisturizer',
        name: 'Hydrating Moisturizer',
        description: 'Lightweight daily moisturizer with hyaluronic acid.',
        priceCents: 3490,
        pointsPrice: 350,
        stock: 0,
        categorySlug: 'wellness',
        imageUrls: [u('photo-1620916566398-39f1143ab7be')],
        variants: [
          { name: '50ml', stock: 25 },
          { name: '100ml', stock: 20, priceCentsOverride: 5490, pointsPriceOverride: 550 },
        ],
      },
      {
        slug: 'ceramic-mug',
        name: 'Ceramic Mug 350ml',
        description: 'Dishwasher-safe ceramic mug, glossy finish.',
        priceCents: 1290,
        pointsPrice: 130,
        stock: 0,
        categorySlug: 'home',
        imageUrls: [u('photo-1485955900006-10f4d324d411')],
        variants: [
          { name: 'Color: White', stock: 30 },
          { name: 'Color: Charcoal', stock: 25 },
          { name: 'Color: Sage', stock: 20 },
        ],
      },
      {
        slug: 'soy-candle',
        name: 'Hand-Poured Soy Candle',
        description: 'Natural soy wax candle, ~40 hour burn time.',
        priceCents: 2490,
        // No points price — purchasable only with cash
        stock: 0,
        categorySlug: 'home',
        imageUrls: [u('photo-1603006905003-be475563bc59')],
        variants: [
          { name: 'Scent: Lavender', stock: 20 },
          { name: 'Scent: Eucalyptus', stock: 20 },
          { name: 'Scent: Vanilla', stock: 20 },
        ],
      },
    ];

    let inserted = 0;
    for (const spec of specs) {
      const exists = await this.products.findOne({ where: { slug: spec.slug } });
      if (exists) {
        // Resync images and featured flag for older seeds. We compare the
        // current image URLs against the spec; if they differ at all (e.g.
        // a previous seed had broken Unsplash IDs that have since been
        // replaced), we replace the image set entirely.
        let dirty = false;
        if (spec.imageUrls?.length) {
          const currentUrls = (exists.images || []).map((i) => i.url);
          const same =
            currentUrls.length === spec.imageUrls.length &&
            currentUrls.every((u, i) => u === spec.imageUrls![i]);
          if (!same) {
            await this.images.delete({ productId: exists.id });
            exists.images = spec.imageUrls.map((url, i) =>
              this.images.create({ url, position: i, productId: exists.id }),
            );
            dirty = true;
          }
        }
        if (spec.featured && !exists.featured) {
          exists.featured = true;
          dirty = true;
        }
        if (dirty) await this.products.save(exists);
        continue;
      }

      const variants = (spec.variants || []).map((v) =>
        this.variants.create({
          name: v.name,
          stock: v.stock,
          priceCentsOverride: v.priceCentsOverride,
          pointsPriceOverride: v.pointsPriceOverride,
          active: true,
        }),
      );

      // If variants are present, the product-level stock is informational —
      // actual availability comes from variant stock.
      const aggregateStock = variants.length
        ? variants.reduce((sum, v) => sum + v.stock, 0)
        : spec.stock;

      const productImages = (spec.imageUrls || []).map((url, i) =>
        this.images.create({ url, position: i }),
      );

      const product = this.products.create({
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        priceCents: spec.priceCents,
        pointsPrice: spec.pointsPrice ?? null,
        currency: 'SGD',
        stock: aggregateStock,
        active: true,
        featured: spec.featured ?? false,
        vendorId: vendor.id,
        categoryId: cats[spec.categorySlug].id,
        variants,
        images: productImages,
      });
      await this.products.save(product);
      inserted++;
    }
    return inserted;
  }
}
