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

  // Price is mandatory; expressed in minor units (cents) to avoid float issues
  @Column({ type: 'integer' })
  priceCents: number;

  @Column({ default: 'SGD' })
  currency: string;

  // Points are optional. If null, product cannot be purchased with points.
  @Column({ type: 'integer', nullable: true })
  pointsPrice?: number;

  @Column({ default: 0 })
  stock: number;

  @Column({ default: true })
  active: boolean;

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
