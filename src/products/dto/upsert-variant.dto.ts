import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertVariantDto {
  @IsOptional() @IsString() id?: string;
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsInt() @Min(0) priceCentsOverride?: number;
  @IsOptional() @IsInt() @Min(0) ppzPriceCentsOverride?: number;
  @IsOptional() @IsInt() @Min(0) pointsPriceOverride?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
