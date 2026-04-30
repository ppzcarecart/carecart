import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

const DEFAULTS: Record<string, string> = {
  pointsPerDollar: '50',
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();

  constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

  async onModuleInit() {
    const all = await this.repo.find();
    for (const s of all) this.cache.set(s.key, s.value);
    // Seed any missing defaults so the app always has known-good values.
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!this.cache.has(k)) await this.set(k, v);
    }
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  getInt(key: string, fallback = 0): number {
    const v = this.get(key);
    if (v == null) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  pointsPerDollar(): number {
    return this.getInt('pointsPerDollar', 50);
  }

  async set(key: string, value: string) {
    let row = await this.repo.findOne({ where: { key } });
    if (row) {
      row.value = value;
    } else {
      row = this.repo.create({ key, value });
    }
    await this.repo.save(row);
    this.cache.set(key, value);
    return row;
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const out: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}
