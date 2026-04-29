import {
  IsArray,
  IsBoolean,
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
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) pointsPrice?: number | null;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) imageUrls?: string[];
}
