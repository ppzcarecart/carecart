import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Generic key/value store for app-wide settings the admin can tune
 * without a redeploy (e.g. pointsPerDollar). Values are stored as
 * strings; SettingsService coerces on read.
 */
@Entity('settings')
export class Setting {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
