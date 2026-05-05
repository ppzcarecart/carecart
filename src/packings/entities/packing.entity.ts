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
 * A "packing" is a per-(customer, vendor) bundle of OrderItems that the
 * vendor (or admin/manager on their behalf) physically packs together.
 * Multiple paid orders from the same customer for the same vendor merge
 * into the same OPEN packing so staff don't have to pack each order
 * separately. Once marked packed, the bundle is closed and any further
 * paid items from that customer spawn a fresh packing.
 *
 * No inverse OneToMany on OrderItem — to avoid the circular import
 * dance we just keep an `items` query in the service via packingId.
 */
@Entity('packings')
@Index(['customerId', 'vendorId', 'status'])
export class Packing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: User;

  @Column({ nullable: true })
  customerId?: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vendorId' })
  vendor?: User;

  @Column({ nullable: true })
  vendorId?: string;

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
