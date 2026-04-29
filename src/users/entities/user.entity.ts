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

  // Vendor display fields
  @Column({ nullable: true })
  vendorStoreName?: string;

  @Column({ nullable: true, type: 'text' })
  vendorBio?: string;

  // External points-system identifier (set when integrator API is available)
  @Column({ nullable: true })
  pointsAccountId?: string;

  @OneToMany(() => Address, (a) => a.user, { cascade: true, eager: true })
  addresses: Address[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
