import { IsOptional, IsString, Matches } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from './password-policy';

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}
