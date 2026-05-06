import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column()
  productId: string;

  @Column()
  name: string; // e.g. "Size: M / Color: Red"

  @Column({ nullable: true })
  sku?: string;

  // Variant-level pricing optionally overrides product-level pricing
  @Column({ type: 'integer', nullable: true })
  priceCentsOverride?: number;

  @Column({ type: 'integer', nullable: true })
  ppzPriceCentsOverride?: number;

  @Column({ type: 'integer', nullable: true })
  pointsPriceOverride?: number;

  @Column({ default: 0 })
  stock: number;

  @Column({ default: true })
  active: boolean;

  // Optional per-variant image. When set, the storefront product
  // detail swaps the main gallery image to this URL whenever the
  // matching variant is selected from the dropdown. Falls back to
  // the product's first image when null.
  @Column({ nullable: true })
  imageUrl?: string;

  // Optional per-variant description. Shown as an add-on under the
  // main product description on the storefront detail page whenever
  // this variant is the active selection.
  @Column({ type: 'text', nullable: true })
  description?: string;
}
