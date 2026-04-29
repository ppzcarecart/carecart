import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type PointsTxKind = 'redeem' | 'reverse' | 'adjust';
export type PointsTxStatus = 'pending' | 'confirmed' | 'failed' | 'reversed';

@Entity('points_transactions')
export class PointsTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ nullable: true })
  userId?: string;

  @Column({ nullable: true })
  orderId?: string;

  @Column()
  kind: PointsTxKind;

  @Column({ default: 'pending' })
  status: PointsTxStatus;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ nullable: true })
  externalRef?: string;

  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
