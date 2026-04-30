import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PointsService } from './points.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('api/points')
export class PointsController {
  constructor(private points: PointsService) {}

  @Get('balance')
  balance(@CurrentUser() user: any) {
    return this.points.getBalance(user.id);
  }

  /** Admin-only: credit a fixed amount of PPZ points to a linked user. */
  @Roles(Role.ADMIN)
  @Post('users/:id/add')
  async addToUser(
    @Param('id') id: string,
    @Body() body: { amount: number; reason: string },
  ) {
    return this.points.addPoints(id, Number(body?.amount), body?.reason ?? '');
  }

  /**
   * Admin/manager: pull the latest profile for every user that has a
   * ppzId. Returns counts so the caller can show "synced X of Y".
   */
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync-all')
  syncAll() {
    return this.points.syncAllPpzUsers();
  }

  /**
   * Admin/manager: pull the latest profile from the partner app for a
   * specific user (balance, lifetime, team, name, contact, address).
   * Useful when staff want fresh values without waiting for the user
   * to log in.
   */
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('users/:id/sync')
  async syncUser(@Param('id') id: string) {
    const result = await this.points.syncProfile(id);
    const u = result.user;
    return {
      ok: true,
      notLinked: 'notLinked' in result ? result.notLinked : false,
      notConfigured: 'notConfigured' in result ? result.notConfigured : false,
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        contact: u.contact,
        ppzId: u.ppzId,
        ppzCurrency: u.ppzCurrency,
        lifetimePpzCurrency: u.lifetimePpzCurrency,
        team: u.team,
      },
    };
  }

  /**
   * Pull the latest profile from the partner app (balance, lifetime,
   * team, name, contact, email, default address) and write it to the
   * local row.
   */
  @Post('sync-profile')
  async syncProfile(@CurrentUser() user: any) {
    const result = await this.points.syncProfile(user.id);
    const u = result.user;
    const defaultAddress =
      (u.addresses || []).find((a: any) => a.isDefault) ||
      (u.addresses || [])[0] ||
      null;
    return {
      ok: true,
      notLinked: 'notLinked' in result ? result.notLinked : false,
      notConfigured: 'notConfigured' in result ? result.notConfigured : false,
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        contact: u.contact,
        ppzId: u.ppzId,
        ppzCurrency: u.ppzCurrency,
        lifetimePpzCurrency: u.lifetimePpzCurrency,
        team: u.team,
        address: defaultAddress
          ? {
              line1: defaultAddress.line1,
              line2: defaultAddress.line2,
              city: defaultAddress.city,
              state: defaultAddress.state,
              postalCode: defaultAddress.postalCode,
              country: defaultAddress.country,
            }
          : null,
      },
    };
  }
}
