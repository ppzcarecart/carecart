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

  // Shipping snapshot
  @Column({ type: 'jsonb', nullable: true })
  shippingAddress?: Record<string, any>;

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
