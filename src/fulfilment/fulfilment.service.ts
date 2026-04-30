import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SettingsService } from '../settings/settings.service';
import { User } from '../users/entities/user.entity';
import { Product } from '../products/entities/product.entity';

export interface CollectionPoint {
  source: 'admin' | 'vendor';
  vendorId?: string;
  vendorName?: string;
  line1: string;
  line2?: string;
  postalCode?: string;
  contact?: string;
  hours?: string;
  country: string;
}

/**
 * Resolves fulfilment data (collection point + delivery fee) for products
 * by stacking the per-item override → vendor override → admin global
 * default.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    private settings: SettingsService,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  isDeliveryEnabled(): boolean {
    return this.settings.isDeliveryEnabled();
  }

  globalDeliveryFeeCents(): number {
    return this.settings.deliveryFeeCents();
  }

  /**
   * Resolve the delivery fee for a product line. Order:
   *   1. product.deliveryFeeCentsOverride (if set)
   *   2. vendor.useOwnDeliveryFee && vendor.vendorDeliveryFeeCents
   *   3. settings delivery.feeCents (global default)
   */
  async resolveDeliveryFee(product: Product): Promise<number> {
    if (product.deliveryFeeCentsOverride != null) {
      return product.deliveryFeeCentsOverride;
    }
    if (product.vendorId) {
      const v = await this.users.findOne({ where: { id: product.vendorId } });
      if (v?.useOwnDeliveryFee && v.vendorDeliveryFeeCents != null) {
        return v.vendorDeliveryFeeCents;
      }
    }
    return this.globalDeliveryFeeCents();
  }

  /**
   * Resolve the self-collection point for a vendor. Vendor's own location
   * if they've ticked the override and provided a line1; otherwise the
   * admin global collection point.
   */
  async resolveCollectionPoint(
    vendorId: string | undefined,
  ): Promise<CollectionPoint> {
    if (vendorId) {
      const v = await this.users.findOne({ where: { id: vendorId } });
      if (v?.useOwnCollectionLocation && v.collectionLine1) {
        return {
          source: 'vendor',
          vendorId: v.id,
          vendorName: v.vendorStoreName || v.name,
          line1: v.collectionLine1,
          line2: v.collectionLine2,
          postalCode: v.collectionPostalCode,
          contact: v.collectionContact,
          hours: v.collectionHours,
          country: 'SG',
        };
      }
    }
    const c = this.settings.collectionPoint();
    return {
      source: 'admin',
      vendorName: 'PPZ Collection Point',
      line1: c.line1,
      line2: c.line2,
      postalCode: c.postalCode,
      contact: c.contact,
      hours: c.hours,
      country: 'SG',
    };
  }
}
