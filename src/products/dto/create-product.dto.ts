import {
  IsArray,
  IsBoolean,
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

  @IsOptional() @IsInt() @Min(0) stock?: number;

  @IsOptional() @IsBoolean() active?: boolean;

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
