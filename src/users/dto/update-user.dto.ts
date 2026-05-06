import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { PPZ_ROLES, PpzRole } from '../ppz-role';

export class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  // ISO 8601 datetime string; null clears the expiry (role is permanent).
  // When set together with `role`, defines when the temporary role
  // auto-reverts to the previous default (e.g. customer).
  @IsOptional() @IsDateString() roleExpiresAt?: string | null;
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

  // PPZ hierarchy role — admin/manager only. Auto-promotion handles
  // 'new_member' ↔ 'member'; higher tiers are set by hand via this DTO.
  @IsOptional() @IsIn(PPZ_ROLES as readonly string[]) ppzRole?: PpzRole;

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
