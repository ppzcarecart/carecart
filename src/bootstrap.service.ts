import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { UsersService } from './users/users.service';
import { Role } from './common/enums/role.enum';

export const PPZ_FULFILMENT_EMAIL = 'ppz-fulfilment@carecart.local';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private users: UsersService,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureBootstrapAdmin();
    await this.ensurePpzFulfilmentVendor();
    // Managers transact on behalf of PPZ Fulfilment, so they share its
    // store name. Run after ensurePpzFulfilmentVendor so a brand-new
    // deployment that just seeded the vendor immediately propagates to
    // any pre-existing managers.
    const r = await this.users.syncAllManagersStoreName();
    if (r.updated > 0) {
      this.logger.log(`Synced PPZ Fulfilment store name to ${r.updated} manager(s)`);
    }
  }

  private async ensureBootstrapAdmin() {
    const email = this.config.get<string>('BOOTSTRAP_ADMIN_EMAIL');
    const password = this.config.get<string>('BOOTSTRAP_ADMIN_PASSWORD');
    const name = this.config.get<string>('BOOTSTRAP_ADMIN_NAME') || 'Administrator';
    if (!email || !password) return;
    const existingAdmins = await this.users.list({ role: Role.ADMIN });
    if (existingAdmins.length > 0) return;

    const existing = await this.users.findByEmail(email);
    if (existing) return;

    await this.users.createUser({
      email,
      password,
      name,
      role: Role.ADMIN,
    });
    this.logger.log(`Bootstrap admin created: ${email}`);
  }

  /**
   * System vendor used as the default fulfilment owner when admin or
   * manager add a product without choosing a third-party vendor. Has a
   * random unrecoverable password — no one logs into this account; it
   * just owns "first-party" products.
   */
  private async ensurePpzFulfilmentVendor() {
    const existing = await this.users.findByEmail(PPZ_FULFILMENT_EMAIL);
    if (existing) return;
    await this.users.createUser({
      email: PPZ_FULFILMENT_EMAIL,
      password: crypto.randomBytes(24).toString('hex'),
      name: 'PPZ Fulfilment',
      vendorStoreName: 'PPZ Fulfilment',
      role: Role.VENDOR,
    });
    this.logger.log('System PPZ Fulfilment vendor created');
  }
}
