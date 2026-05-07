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

  // When non-null, the user's current `role` is a temporary override
  // that auto-reverts to `roleBeforeOverride` (or CUSTOMER if null)
  // the first time UsersService.findById is called past this
  // timestamp. NULL = no expiry (forever). roleBeforeOverride is a
  // plain varchar (not the Role enum) so synchronize doesn't have to
  // ALTER the Postgres users_role_enum type to add a second column —
  // that ALTER fails silently on some hosts and was nuking the
  // roleExpiresAt value at save time.
  @Column({ type: 'timestamptz', nullable: true })
  roleExpiresAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  roleBeforeOverride?: Role | null;

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

  // Vendor fulfilment overrides. When useOwnCollectionLocation is true and
  // the address is filled in, this vendor's products show the vendor
  // address as their collection point at checkout instead of the admin's
  // global one. Same for delivery fee.
  @Column({ default: false })
  useOwnCollectionLocation: boolean;

  @Column({ nullable: true }) collectionLine1?: string;
  @Column({ nullable: true }) collectionLine2?: string;
  @Column({ nullable: true }) collectionPostalCode?: string;
  @Column({ nullable: true }) collectionContact?: string;
  @Column({ nullable: true }) collectionHours?: string;

  @Column({ default: false })
  useOwnDeliveryFee: boolean;

  @Column({ type: 'integer', nullable: true })
  vendorDeliveryFeeCents?: number;

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

  // PPZ hierarchy role. Only meaningful for users with a ppzId.
  // 'new_member' on first sync (lifetime < 2000), auto-bumped to
  // 'member' when lifetime >= 2000. Higher tiers (leader → artist)
  // are admin-managed and the auto-job leaves them alone.
  // See src/users/ppz-role.ts for the full enum and helper.
  @Column({ type: 'varchar', nullable: true })
  ppzRole?: string;

  @OneToMany(() => Address, (a) => a.user, { cascade: true, eager: true })
  addresses: Address[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
