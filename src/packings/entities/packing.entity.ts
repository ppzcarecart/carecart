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

export type PackingStatus = 'open' | 'packed' | 'collected';
export type PackingFulfilment = 'delivery' | 'collection';

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
@Index(['customerId', 'fulfilmentMethod', 'status'])
export class Packing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: User;

  @Column({ nullable: true })
  customerId?: string;

  // Each packing is now scoped to a single fulfilment path so the
  // collection workflow (QR pickup) and delivery workflow (ship) don't
  // bleed into each other. Nullable for legacy rows from before this
  // column existed; new packings always set it from the order.
  @Column({ type: 'varchar', nullable: true })
  fulfilmentMethod?: PackingFulfilment;

  @Column({ default: 'open' })
  status: PackingStatus;

  @Column({ type: 'timestamptz', nullable: true })
  packedAt?: Date;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'packedById' })
  packedBy?: User;

  @Column({ nullable: true })
  packedById?: string;

  // Set when the customer's collection bundle is scanned at the pickup
  // counter. The packing itself moves to 'collected' and every
  // constituent order also flips to status='collected' so existing
  // sales / order screens stay consistent.
  @Column({ type: 'timestamptz', nullable: true })
  collectedAt?: Date;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'collectedById' })
  collectedBy?: User;

  @Column({ nullable: true })
  collectedById?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
