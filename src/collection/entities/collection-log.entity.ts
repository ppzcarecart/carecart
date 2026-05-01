import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';

export type CollectionResult =
  | 'success'
  | 'duplicate'
  | 'unauthorized_vendor'
  | 'not_found'
  | 'invalid_state';

@Entity('collection_logs')
export class CollectionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Whatever the scanner read. We log the raw value so audits can see
  // misreads or attempts on numbers that don't exist in the system.
  @Column()
  scannedValue: string;

  @ManyToOne(() => Order, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'orderId' })
  order?: Order;

  @Column({ nullable: true })
  orderId?: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'scannedById' })
  scannedBy?: User;

  @Column({ nullable: true })
  scannedById?: string;

  @Column({ type: 'varchar' })
  result: CollectionResult;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt: Date;
}
