import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.access_token,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-secret',
    });
  }

  /**
   * Look up the user fresh on each request so views and guards see live
   * `ppzCurrency`, `lifetimePpzCurrency`, and `active` state — not whatever
   * was true when the token was issued. Cost is one indexed PK lookup per
   * authenticated request.
   */
  async validate(payload: any) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException('Account not available');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      ppzId: user.ppzId,
      ppzCurrency: user.ppzCurrency,
      lifetimePpzCurrency: user.lifetimePpzCurrency,
      team: user.team,
      vendorStoreName: user.vendorStoreName,
    };
  }
}
