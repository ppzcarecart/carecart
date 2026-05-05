import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';
import { ProductVariant } from '../../products/entities/product-variant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column()
  orderId: string;

  @ManyToOne(() => Product, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ nullable: true })
  productId?: string;

  @ManyToOne(() => ProductVariant, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'variantId' })
  variant?: ProductVariant;

  @Column({ nullable: true })
  variantId?: string;

  // Vendor snapshot (for vendor sales reporting even after product deletion)
  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vendorId' })
  vendor?: User;

  @Column({ nullable: true })
  vendorId?: string;

  @Column()
  productName: string;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ type: 'integer', default: 0 })
  unitPriceCents: number;

  @Column({ type: 'integer', default: 0 })
  unitPoints: number;

  @Column({ type: 'varchar', default: 'price' })
  pricingMode: 'price' | 'points';

  // Packing assignment — set when the order moves to 'paid'. Items are
  // grouped per (customer, vendor) into an OPEN packing, or a new one
  // if there isn't one yet. NULL until paid (and again if the order is
  // cancelled/refunded, in which case we detach to keep the packing
  // representative of what's actually shippable).
  @Column({ nullable: true })
  packingId?: string;
}
