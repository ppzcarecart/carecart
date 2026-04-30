import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from './password-policy';

export class RegisterAddressDto {
  @IsString() line1: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsString() postalCode: string;
  // Singapore-only at the moment. Free-typed value is ignored and
  // normalised to "SG" by UsersService.createUser.
  @IsOptional() @IsString() country?: string;
}

export class RegisterDto {
  @IsEmail() email: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @IsString() name: string;
  @IsOptional() @IsString() contact?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegisterAddressDto)
  address?: RegisterAddressDto;
}
