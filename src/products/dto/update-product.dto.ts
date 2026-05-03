import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) ppzPriceCents?: number | null;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) pointsPrice?: number | null;
  @IsOptional() @IsBoolean() allowPointsRedemption?: boolean;
  @IsOptional() @IsInt() @Min(0) deliveryFeeCentsOverride?: number | null;
  @IsOptional() @IsBoolean() collectionOnly?: boolean;
  @IsOptional() @IsIn(['admin', 'vendor', null]) collectionSource?: 'admin' | 'vendor' | null;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) imageUrls?: string[];
}
