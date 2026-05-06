import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVariantDto {
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsInt() @Min(0) priceCentsOverride?: number;
  @IsOptional() @IsInt() @Min(0) ppzPriceCentsOverride?: number;
  @IsOptional() @IsInt() @Min(0) pointsPriceOverride?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateProductDto {
  @IsString() name: string;

  @IsOptional() @IsString() slug?: string;

  @IsOptional() @IsString() description?: string;

  // Normal price is mandatory (in cents)
  @IsInt() @Min(0) priceCents: number;

  // PPZ member price (optional). When set, members see and pay this instead.
  @IsOptional() @IsInt() @Min(0) ppzPriceCents?: number;

  @IsOptional() @IsString() currency?: string;

  // Points are optional
  @IsOptional() @IsInt() @Min(0) pointsPrice?: number;

  // When true, points are auto-calculated server-side from the price.
  @IsOptional() @IsBoolean() allowPointsRedemption?: boolean;

  // Per-item delivery fee override (cents). Null/undefined means "use the
  // vendor's default or the global default from settings".
  @IsOptional() @IsInt() @Min(0) deliveryFeeCentsOverride?: number;

  // Disables Delivery at checkout when this product is in the cart —
  // the customer can only self-collect.
  @IsOptional() @IsBoolean() collectionOnly?: boolean;

  // Per-product override of where collection happens. Null = fall back
  // to the vendor's own setting; 'admin' / 'vendor' force the source.
  @IsOptional() @IsIn(['admin', 'vendor']) collectionSource?: 'admin' | 'vendor';

  @IsOptional() @IsInt() @Min(0) stock?: number;

  @IsOptional() @IsBoolean() active?: boolean;

  @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @IsOptional() @IsInt() @Min(0) redeemLimitPerCustomer?: number;
  @IsOptional() @IsInt() @Min(0) redeemLimitWindowDays?: number;

  @IsOptional() @IsString() categoryId?: string;

  // Admin/manager may pass vendorId; vendors always create under their own id
  @IsOptional() @IsString() vendorId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
