import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import {
  PASSWORD_REGEX,
  PASSWORD_RULE_MESSAGE,
} from '../../auth/dto/password-policy';

export class CreateUserDto {
  @IsEmail() email: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  password: string;
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
