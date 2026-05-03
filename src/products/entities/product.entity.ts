import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Category } from '../../categories/entities/category.entity';
import { ProductVariant } from './product-variant.entity';
import { ProductImage } from './product-image.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // Normal cash price — what non-PPZ customers see. Mandatory.
  // Expressed in minor units (cents) to avoid float issues.
  @Column({ type: 'integer' })
  priceCents: number;

  // PPZ member cash price. When set and the buyer has a ppzId, this
  // replaces priceCents in the storefront display and at checkout.
  // Falls back to priceCents when null.
  @Column({ type: 'integer', nullable: true })
  ppzPriceCents?: number;

  @Column({ default: 'SGD' })
  currency: string;

  // Points are optional. If null, product cannot be purchased with points.
  // Only PPZ-linked customers see / can use the points option.
  @Column({ type: 'integer', nullable: true })
  pointsPrice?: number;

  // When true, the points cost is auto-derived from the cash price using
  // the global pointsPerDollar rate (rounding any cents up to the next
  // whole dollar). Overrides any manual pointsPrice for this product.
  @Column({ default: false })
  allowPointsRedemption: boolean;

  // Per-item delivery fee override. When set, takes precedence over the
  // vendor's own fee and the admin global default.
  @Column({ type: 'integer', nullable: true })
  deliveryFeeCentsOverride?: number;

  // When true, this product can only be picked up — Delivery is
  // disabled at checkout for any cart that contains this product. The
  // customer is forced into self-collection.
  @Column({ default: false })
  collectionOnly: boolean;

  // Per-product override for which location is used at collection.
  //   'admin'  → always use the admin's global PPZ collection point
  //   'vendor' → always use the product's vendor collection address
  //   null     → fall back to the vendor-level useOwnCollectionLocation
  //              flag (the existing behaviour)
  // Decoupling this from the vendor-level toggle lets vendors split:
  // e.g. some products picked up at the storefront, others at PPZ.
  @Column({ type: 'varchar', nullable: true })
  collectionSource?: 'admin' | 'vendor' | null;

  @Column({ default: 0 })
  stock: number;

  @Column({ default: true })
  active: boolean;

  // Force-off cascaded from a vendor being disabled by admin/manager.
  // Distinct from `active` (which the vendor controls themselves);
  // disabled products are hidden everywhere except the dedicated
  // /admin/products/disabled view, and flip back automatically when
  // the vendor is re-enabled.
  @Column({ default: false })
  disabled: boolean;

  @Column({ default: false })
  featured: boolean;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendorId' })
  vendor: User;

  @Column()
  vendorId: string;

  @ManyToOne(() => Category, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category?: Category;

  @Column({ nullable: true })
  categoryId?: string;

  @OneToMany(() => ProductVariant, (v) => v.product, { cascade: true, eager: true })
  variants: ProductVariant[];

  @OneToMany(() => ProductImage, (i) => i.product, { cascade: true, eager: true })
  images: ProductImage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
