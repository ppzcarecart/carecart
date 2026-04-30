import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

const DEFAULTS: Record<string, string> = {
  pointsPerDollar: '50',
  // Self-collection point shown when an order's fulfilment method is
  // "collection" and the vendor hasn't set their own location.
  'collection.line1': '',
  'collection.line2': '',
  'collection.postalCode': '',
  'collection.contact': '',
  'collection.hours': '',
  // Delivery
  'delivery.enabled': 'true',
  // Default delivery fee (in cents) used when a product has no override
  // and the vendor hasn't set their own.
  'delivery.feeCents': '500',
  // Deep-link URL the mobile bottom-nav "Home" button navigates to in
  // order to close the in-app webview and return to the partner native
  // app. The partner app's webview delegate intercepts this URL and
  // dismisses the webview. Empty value = the button only does
  // history.back().
  'partner.closeUrl': 'papazao://close',
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

  isDeliveryEnabled(): boolean {
    return this.get('delivery.enabled') === 'true';
  }

  deliveryFeeCents(): number {
    return this.getInt('delivery.feeCents', 0);
  }

  collectionPoint() {
    return {
      line1: this.get('collection.line1') || '',
      line2: this.get('collection.line2') || '',
      postalCode: this.get('collection.postalCode') || '',
      contact: this.get('collection.contact') || '',
      hours: this.get('collection.hours') || '',
      country: 'SG',
    };
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
