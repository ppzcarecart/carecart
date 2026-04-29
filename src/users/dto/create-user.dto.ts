import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsString() name: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEnum(Role) role?: Role;

  // Address fields collapsed for ergonomic admin / bulk import
  @IsOptional() @IsString() address?: string;

  @IsOptional() @IsString() vendorStoreName?: string;

  // Optional customer fields from the external ppz/points system
  @IsOptional() @IsString() ppzId?: string;
  @IsOptional() @IsInt() @Min(0) ppzCurrency?: number;
  @IsOptional() @IsInt() @Min(0) lifetimePpzCurrency?: number;
  @IsOptional() @IsInt() team?: number;
}
