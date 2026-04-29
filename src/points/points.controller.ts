import { Controller, Get, Post } from '@nestjs/common';
import { PointsService } from './points.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/points')
export class PointsController {
  constructor(private points: PointsService) {}

  @Get('balance')
  balance(@CurrentUser() user: any) {
    return this.points.getBalance(user.id);
  }

  /**
   * Pull the latest profile from the partner app (balance, lifetime,
   * team, name, contact) and write it to the local row.
   */
  @Post('sync-profile')
  async syncProfile(@CurrentUser() user: any) {
    const result = await this.points.syncProfile(user.id);
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
}
