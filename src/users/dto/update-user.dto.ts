import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Role } from '../../common/enums/role.enum';

export class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() vendorStoreName?: string;
  @IsOptional() @IsString() vendorBio?: string;
  @IsOptional() @IsString() pointsAccountId?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;

  // Customer fields synced from the external ppz/points system
  @IsOptional() @IsString() ppzId?: string;
  @IsOptional() @IsInt() @Min(0) ppzCurrency?: number;
  @IsOptional() @IsInt() @Min(0) lifetimePpzCurrency?: number;
  @IsOptional() @IsInt() team?: number;

  // Vendor fulfilment overrides
  @IsOptional() @IsBoolean() useOwnCollectionLocation?: boolean;
  @IsOptional() @IsString() collectionLine1?: string;
  @IsOptional() @IsString() collectionLine2?: string;
  @IsOptional() @IsString() collectionPostalCode?: string;
  @IsOptional() @IsString() collectionContact?: string;
  @IsOptional() @IsString() collectionHours?: string;
  @IsOptional() @IsBoolean() useOwnDeliveryFee?: boolean;
  @IsOptional() @IsInt() @Min(0) vendorDeliveryFeeCents?: number;
}
