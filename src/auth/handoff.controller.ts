import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import * as crypto from 'crypto';

import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PointsClient } from '../points/points.client';
import { Role } from '../common/enums/role.enum';

/**
 * H5 / SSO handoff from the partner app.
 *
 * The partner app links to:
 *   GET /h5/login?ppzid=4896&email=john@email.com&redirect=/p/some-product
 *
 * We:
 *   1. Look the user up via the PPZ Ecom API (server-side, with x-api-key).
 *   2. Verify the supplied email matches the API record.
 *   3. Upsert a local customer row (creating one with a random password
 *      if this is their first visit; otherwise refreshing cached fields).
 *   4. Issue a JWT cookie and 302 to the requested page.
 */
@Controller('h5')
export class HandoffController {
  private readonly logger = new Logger(HandoffController.name);

  constructor(
    private auth: AuthService,
    private users: UsersService,
    private points: PointsClient,
  ) {}

  @Public()
  @Get('login')
  async login(
    @Query('ppzid') ppzid: string,
    @Query('email') email: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    if (!ppzid || !email) {
      throw new BadRequestException('ppzid and email are required');
    }
    if (!this.points.isConfigured()) {
      this.logger.error('Handoff hit but PPZ_API_KEY is not configured');
      return res.redirect('/login?error=ppz_not_configured');
    }

    let ppzUser;
    try {
      ppzUser = await this.points.getUser(ppzid);
    } catch (e: any) {
      const code = e?.code;
      if (code === 404) return res.redirect('/login?error=ppzid_not_found');
      if (code === 401) return res.redirect('/login?error=ppz_auth');
      this.logger.error(`Handoff getUser failed: ${e.message}`);
      return res.redirect('/login?error=ppz_lookup');
    }

    // Email guard — both must match the PPZ record (case-insensitive).
    if (
      !ppzUser.email ||
      ppzUser.email.toLowerCase().trim() !== email.toLowerCase().trim()
    ) {
      return res.redirect('/login?error=email_mismatch');
    }

    // Find an existing local row by ppzId first, then by email.
    let user =
      (await this.users.findByPpzId(ppzUser.ppzid)) ||
      (await this.users.findByEmail(ppzUser.email));

    if (!user) {
      user = await this.users.createUser({
        email: ppzUser.email,
        // The user doesn't know this password — they sign in via the
        // handoff. Once they visit /profile and call PATCH
        // /api/auth/password they'll flip hasSetPassword to true and
        // can use /login directly.
        password: crypto.randomBytes(16).toString('hex'),
        name: ppzUser.fullname,
        contact: ppzUser.contact,
        role: Role.CUSTOMER,
        address: ppzUser.address,
        ppzId: ppzUser.ppzid,
        ppzCurrency: ppzUser.ppzcurrency,
        lifetimePpzCurrency: ppzUser.lifetimeppzcurrency,
        team: ppzUser.team,
        hasSetPassword: false,
      });
    } else {
      // Refresh cached fields — the partner app is the source of truth.
      await this.users.update(user.id, {
        ppzId: ppzUser.ppzid,
        ppzCurrency: ppzUser.ppzcurrency,
        lifetimePpzCurrency: ppzUser.lifetimeppzcurrency,
        team: ppzUser.team,
        contact: ppzUser.contact || user.contact,
        name: user.name || ppzUser.fullname,
      } as any);
      user = await this.users.findById(user.id);
    }

    if (!user.active) {
      return res.redirect('/login?error=account_disabled');
    }

    const { access_token } = this.auth.issueToken(user);
    res.cookie('access_token', access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Only allow same-origin redirects to prevent open-redirect abuse.
    const target =
      redirect && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : '/';
    return res.redirect(target);
  }
}
