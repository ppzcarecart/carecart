import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import { User } from './entities/user.entity';
import { Address } from './entities/address.entity';
import { Role } from '../common/enums/role.enum';

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
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Address) private addressRepo: Repository<Address>,
  ) {}

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  list(filter?: { role?: Role; active?: boolean }) {
    return this.repo.find({
      where: filter ?? {},
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
    });

    if (input.address) {
      const addr =
        typeof input.address === 'string'
          ? { line1: input.address, country: 'SG' }
          : { country: 'SG', ...input.address };
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
    Object.assign(user, patch);
    return this.repo.save(user);
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
