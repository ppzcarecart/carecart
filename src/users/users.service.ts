import {
  BadRequestException,
  Injectable,
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

  async createUser(input: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = this.repo.create({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      contact: input.contact,
      role: input.role ?? Role.CUSTOMER,
      vendorStoreName: input.vendorStoreName,
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
    Object.assign(user, patch);
    const saved = await this.repo.save(user);

    // Cascade vendor enable/disable to their products. Distinct from
    // each product's own `active` flag — `disabled=true` is a forced
    // off-shelf state set by admin/manager when the vendor account is
    // deactivated. Re-enabling the vendor flips them all back so the
    // vendor doesn't have to manually un-disable each one.
    if (
      saved.role === Role.VENDOR &&
      patch.active !== undefined &&
      wasActive !== saved.active
    ) {
      await this.productsRepo.update(
        { vendorId: saved.id },
        { disabled: !saved.active },
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
