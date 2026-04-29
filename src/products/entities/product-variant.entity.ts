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
  pointsPriceOverride?: number;

  @Column({ default: 0 })
  stock: number;

  @Column({ default: true })
  active: boolean;
}
