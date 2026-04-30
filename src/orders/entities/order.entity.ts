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
import { OrderItem } from './order-item.entity';

export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type FulfilmentMethod = 'delivery' | 'collection';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  number: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: User;

  @Column({ nullable: true })
  customerId?: string;

  @Column({ default: 'pending' })
  status: OrderStatus;

  @Column({ type: 'integer', default: 0 })
  subtotalCents: number;

  @Column({ type: 'integer', default: 0 })
  totalCents: number;

  @Column({ type: 'integer', default: 0 })
  pointsTotal: number;

  @Column({ default: 'SGD' })
  currency: string;

  // Fulfilment
  @Column({ type: 'varchar', default: 'delivery' })
  fulfilmentMethod: FulfilmentMethod;

  @Column({ type: 'integer', default: 0 })
  deliveryFeeCents: number;

  // For "collection" orders we snapshot the picked points into the order
  // (one per vendor) so the customer's confirmation / order detail keeps
  // showing the right place even if the vendor later changes settings.
  @Column({ type: 'jsonb', nullable: true })
  collectionPoints?: Array<{
    vendorId?: string;
    vendorName?: string;
    line1?: string;
    line2?: string;
    postalCode?: string;
    contact?: string;
    hours?: string;
    source?: 'admin' | 'vendor';
  }>;

  // Shipping snapshot (used for delivery orders)
  @Column({ type: 'jsonb', nullable: true })
  shippingAddress?: Record<string, any>;

  // Captured by the staff/vendor when an order is refunded; required at
  // refund time and surfaced under "Remarks" on the order detail page.
  @Column({ type: 'text', nullable: true })
  refundReason?: string;

  // Selected payment provider, e.g. 'stripe' or future gateway
  @Column({ nullable: true })
  paymentProvider?: string;

  @Column({ nullable: true })
  paymentIntentId?: string;

  @OneToMany(() => OrderItem, (i) => i.order, { cascade: true, eager: true })
  items: OrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
