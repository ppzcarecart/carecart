import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type PackingStatus = 'open' | 'packed';

/**
 * A "packing" is a per-customer bundle of OrderItems that staff
 * physically pack together. Every unpacked paid order from a customer
 * merges into the same OPEN packing — even if the items span multiple
 * vendors — so the warehouse sees one place to pull everything for that
 * customer. Once marked packed the bundle is closed; subsequent paid
 * orders from that customer spawn a fresh packing.
 *
 * Vendor scope is computed from item.vendorId at query time (a vendor
 * sees only the packings that contain at least one of their items, and
 * only those items in the detail view). No inverse OneToMany on
 * OrderItem — to avoid the circular import dance we just keep an
 * `items` query in the service via packingId.
 */
@Entity('packings')
@Index(['customerId', 'status'])
export class Packing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: User;

  @Column({ nullable: true })
  customerId?: string;

  @Column({ default: 'open' })
  status: PackingStatus;

  @Column({ type: 'timestamptz', nullable: true })
  packedAt?: Date;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'packedById' })
  packedBy?: User;

  @Column({ nullable: true })
  packedById?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
