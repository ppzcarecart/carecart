import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import { User } from './entities/user.entity';
import { Address } from './entities/address.entity';
import { Role } from '../common/enums/role.enum';
import { Product } from '../products/entities/product.entity';
import { PpzRole } from './ppz-role';

// Email of the system-owned vendor created by BootstrapService. All
// managers carry the same vendorStoreName as this vendor — the assumption
// is that managers transact on behalf of PPZ Fulfilment, so they share
// its branding. Kept here (rather than imported from bootstrap.service)
// to avoid the bootstrap → users circular import.
const PPZ_FULFILMENT_EMAIL = 'ppz-fulfilment@carecart.local';

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  contact?: string;
  role?: Role;
  address?: {
    line1: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | string;
  vendorStoreName?: string;
  ppzId?: string;
  ppzCurrency?: number;
  lifetimePpzCurrency?: number;
  team?: number;
  hasSetPassword?: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Address) private addressRepo: Repository<Address>,
    @InjectRepository(Product) private productsRepo: Repository<Product>,
  ) {}

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  findByPpzId(ppzId: string) {
    return this.repo.findOne({ where: { ppzId } });
  }

  /**
   * Search + filter the users table for the admin/users page.
   *   - role / ppzRole / active are exact-match column filters.
   *   - q is a fuzzy ILIKE across name, email, contact, and ppzId so
   *     the same search bar works for each of those identifiers.
   * Empty filter returns every user (existing call-sites unchanged).
   */
  list(filter?: {
    role?: Role;
    active?: boolean;
    ppzRole?: PpzRole | string;
    q?: string;
  }) {
    const exact: Record<string, unknown> = {};
    if (filter?.role) exact.role = filter.role;
    if (filter?.active !== undefined) exact.active = filter.active;
    if (filter?.ppzRole) exact.ppzRole = filter.ppzRole;
    const q = (filter?.q || '').trim();
    if (!q) {
      return this.repo.find({
        where: exact,
        order: { createdAt: 'DESC' },
      });
    }
    // OR across the four searchable columns. Each branch carries the
    // same exact-match constraints so role / ppzRole still narrow the
    // results when the user is also searching.
    const like = ILike(`%${q}%`);
    const where = (
      ['name', 'email', 'contact', 'ppzId'] as const
    ).map((col) => ({ ...exact, [col]: like }));
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Resolve the storeName managers + new managers should adopt. Reads
   * the system PPZ Fulfilment vendor's vendorStoreName so the value
   * survives admin edits to that vendor's branding. Falls back to the
   * literal string if the vendor row hasn't been seeded yet (very
   * early in app boot).
   */
  private async fulfilmentStoreName(): Promise<string> {
    const v = await this.findByEmail(PPZ_FULFILMENT_EMAIL);
    return v?.vendorStoreName || 'PPZ Fulfilment';
  }

  /**
   * Force every existing manager's vendorStoreName to match the PPZ
   * Fulfilment vendor's. Idempotent — single bulk UPDATE. Called from
   * BootstrapService at app start and from update() when the PPZ
   * Fulfilment vendor itself is renamed.
   */
  async syncAllManagersStoreName(): Promise<{ updated: number }> {
    const target = await this.fulfilmentStoreName();
    const res = await this.repo.update(
      { role: Role.MANAGER },
      { vendorStoreName: target } as any,
    );
    return { updated: res.affected ?? 0 };
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, 10);
    // Managers always share the PPZ Fulfilment store name (per
    // marketplace policy); ignore any storeName the caller sent in.
    const storeName =
      (input.role ?? Role.CUSTOMER) === Role.MANAGER
        ? await this.fulfilmentStoreName()
        : input.vendorStoreName;
    const user = this.repo.create({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      contact: input.contact,
      role: input.role ?? Role.CUSTOMER,
      vendorStoreName: storeName,
      ppzId: input.ppzId,
      ppzCurrency: input.ppzCurrency ?? 0,
      lifetimePpzCurrency: input.lifetimePpzCurrency ?? 0,
      team: input.team,
      hasSetPassword: input.hasSetPassword ?? true,
    });

    if (input.address) {
      const raw =
        typeof input.address === 'string'
          ? { line1: input.address }
          : { ...input.address };
      // Singapore-only marketplace — normalise country regardless of input.
      const addr = { ...raw, country: 'SG' };
      user.addresses = [
        this.addressRepo.create({
          ...addr,
          label: 'shipping',
          isDefault: true,
        }),
      ];
    } else {
      user.addresses = [];
    }
    return this.repo.save(user);
  }

  async update(id: string, patch: Partial<User> & { password?: string }) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (patch.password) {
      user.passwordHash = await bcrypt.hash(patch.password, 10);
      delete (patch as any).password;
    }
    const wasActive = user.active;
    const wasFulfilmentVendor =
      user.email === PPZ_FULFILMENT_EMAIL && user.role === Role.VENDOR;
    const previousStoreName = user.vendorStoreName;
    Object.assign(user, patch);

    // Lock manager rows to the PPZ Fulfilment store name. Catches both
    // a customer/vendor being promoted to manager AND an existing
    // manager's storeName being touched manually — they share branding
    // either way.
    if (user.role === Role.MANAGER) {
      user.vendorStoreName = await this.fulfilmentStoreName();
    }

    const saved = await this.repo.save(user);

    // If the PPZ Fulfilment vendor itself was just renamed, propagate
    // the new name to every manager so they stay in sync without
    // waiting for the next app boot.
    if (
      wasFulfilmentVendor &&
      saved.vendorStoreName !== previousStoreName
    ) {
      await this.syncAllManagersStoreName();
    }

    // Diagnostic line for every PATCH that lands here. Logs the role
    // *as persisted* so a "no cascade fired" investigation can tell
    // at a glance whether the target was actually a vendor — the
    // common cause of a "cascade silently skipped" symptom turns out
    // to be the role having been changed away from 'vendor' earlier
    // (e.g. via the role dropdown on /admin/users) which makes the
    // cascade-on-disable correctly no-op.
    this.logger.log(
      `users.update id=${saved.id} email=${saved.email} role=${saved.role} active=${wasActive}→${saved.active} patchKeys=[${Object.keys(patch).join(',')}]`,
    );

    // Cascade vendor enable/disable to their products.
    //   disable vendor → products: active=false, disabled=true
    //   enable vendor  → products: active=true,  disabled=false
    if (saved.role === Role.VENDOR && wasActive !== saved.active) {
      const res = await this.productsRepo.update(
        { vendorId: saved.id },
        { active: saved.active, disabled: !saved.active },
      );
      this.logger.log(
        `Cascade for vendor ${saved.id} touched ${res.affected ?? 0} product row(s)`,
      );
    }

    return saved;
  }

  async remove(id: string) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.repo.remove(user);
    return { ok: true };
  }

  /**
   * Bulk import customers from CSV.
   * Expected headers (case-insensitive): Name, Email, Address, Contact, Password
   * Returns { created, skipped, errors }.
   */
  async bulkImportCustomers(csv: string): Promise<{
    created: number;
    skipped: number;
    errors: { row: number; reason: string }[];
  }> {
    let records: any[];
    try {
      records = parse(csv, {
        columns: (header: string[]) =>
          header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      });
    } catch (e: any) {
      throw new BadRequestException(`Invalid CSV: ${e.message}`);
    }

    let created = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    // Accept either "fullname" or "name" for the name column, and the
    // optional ppz columns (ppzid / ppzcurrency / lifetimeppzcurrency / team).
    const intOrUndef = (v: any) => {
      const s = (v ?? '').toString().trim();
      if (s === '') return undefined;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : undefined;
    };

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const email = (row.email || '').toString().toLowerCase().trim();
      const name = (row.fullname || row.name || '').toString().trim();
      const password = (row.password || '').toString();
      const contact = (row.contact || '').toString().trim() || undefined;
      const address = (row.address || '').toString().trim() || undefined;
      const ppzId = (row.ppzid || '').toString().trim() || undefined;
      const ppzCurrency = intOrUndef(row.ppzcurrency);
      const lifetimePpzCurrency = intOrUndef(row.lifetimeppzcurrency);
      const team = intOrUndef(row.team);

      if (!email || !name || !password) {
        errors.push({ row: i + 2, reason: 'name, email and password are required' });
        continue;
      }
      const existing = await this.findByEmail(email);
      if (existing) {
        skipped++;
        continue;
      }
      try {
        await this.createUser({
          email,
          password,
          name,
          contact,
          role: Role.CUSTOMER,
          address,
          ppzId,
          ppzCurrency,
          lifetimePpzCurrency,
          team,
        });
        created++;
      } catch (e: any) {
        errors.push({ row: i + 2, reason: e.message });
      }
    }
    return { created, skipped, errors };
  }
}
