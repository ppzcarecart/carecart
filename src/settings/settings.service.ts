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
  // Home page hero — admin/manager-editable copy + image tiles.
  'home.hero.eyebrow': 'Multi-vendor marketplace',
  'home.hero.heading': 'Thoughtful goods, by trusted vendors.',
  'home.hero.subheading':
    'Browse curated apparel, wellness essentials, and lifestyle picks. Pay with cash or redeem your points — your call.',
  'home.hero.ctaLabel': 'Shop now',
  'home.hero.ctaHref': '#catalogue',
  'home.hero.tile1':
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=400&q=80',
  'home.hero.tile2':
    'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?auto=format&fit=crop&w=400&q=80',
  'home.hero.tile3':
    'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=400&q=80',
  // Promo banner carousel that renders below the hero. JSON array of
  // { imageUrl, linkUrl } items, max 5. Toggle via home.banners.enabled.
  'home.banners.enabled': 'false',
  'home.banners': '[]',
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

  /** Shape the hero settings into the structure consumed by the views. */
  homeHero() {
    return {
      eyebrow: this.get('home.hero.eyebrow') || '',
      heading: this.get('home.hero.heading') || '',
      subheading: this.get('home.hero.subheading') || '',
      ctaLabel: this.get('home.hero.ctaLabel') || '',
      ctaHref: this.get('home.hero.ctaHref') || '',
      tile1: this.get('home.hero.tile1') || '',
      tile2: this.get('home.hero.tile2') || '',
      tile3: this.get('home.hero.tile3') || '',
    };
  }

  /**
   * Parse the JSON-encoded banner list. Returns at most 5 entries with a
   * non-empty imageUrl. Bad JSON yields []. Caller decides whether to
   * render based on home.banners.enabled.
   */
  homeBanners(): Array<{ imageUrl: string; linkUrl: string }> {
    const raw = this.get('home.banners') || '[]';
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((b) => b && typeof b.imageUrl === 'string' && b.imageUrl.trim())
        .slice(0, 5)
        .map((b) => ({
          imageUrl: String(b.imageUrl).trim(),
          linkUrl: typeof b.linkUrl === 'string' ? b.linkUrl.trim() : '',
        }));
    } catch {
      return [];
    }
  }

  homeBannersEnabled(): boolean {
    return this.get('home.banners.enabled') === 'true';
  }
}
