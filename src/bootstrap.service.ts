import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users/users.service';
import { Role } from './common/enums/role.enum';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private users: UsersService,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
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
}
