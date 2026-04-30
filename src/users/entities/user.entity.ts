import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Address } from './address.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column()
  passwordHash: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  contact?: string;

  @Column({ type: 'enum', enum: Role, default: Role.CUSTOMER })
  role: Role;

  @Column({ default: true })
  active: boolean;

  // True when the user has explicitly chosen their password (registration,
  // admin creation, bulk import, profile change). False when the password
  // was auto-generated for them — currently only the partner-app handoff
  // creates users in that state. They must set a password on /profile
  // before they can sign in directly via /login.
  @Column({ default: true })
  hasSetPassword: boolean;

  // Vendor display fields
  @Column({ nullable: true })
  vendorStoreName?: string;

  @Column({ nullable: true, type: 'text' })
  vendorBio?: string;

  // External points-system identifier (set when integrator API is available)
  @Column({ nullable: true })
  pointsAccountId?: string;

  // ---- Customer fields populated from the external ppz/points system ----
  // ppzId is the customer's external system ID (e.g. "4896").
  @Index()
  @Column({ nullable: true })
  ppzId?: string;

  // Current points balance, cached locally for display. Authoritative value
  // lives in the external points system; refresh via PointsService.
  @Column({ type: 'integer', default: 0 })
  ppzCurrency: number;

  // Lifetime points accumulated, cached locally.
  @Column({ type: 'integer', default: 0 })
  lifetimePpzCurrency: number;

  // Team affiliation code from the external system.
  @Column({ type: 'integer', nullable: true })
  team?: number;

  @OneToMany(() => Address, (a) => a.user, { cascade: true, eager: true })
  addresses: Address[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
