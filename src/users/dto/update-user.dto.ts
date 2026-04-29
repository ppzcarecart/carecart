import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
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
}
