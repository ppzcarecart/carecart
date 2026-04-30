import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('api/settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  async getAll() {
    const all = await this.settings.getAll();
    return {
      pointsPerDollar: parseInt(all.pointsPerDollar || '50', 10),
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch('points-per-dollar')
  async setPointsPerDollar(@Body() body: { value: number }) {
    const v = Number(body?.value);
    if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
      throw new BadRequestException('value must be a positive integer');
    }
    if (v > 100000) {
      throw new BadRequestException('value seems too large; cap at 100000');
    }
    await this.settings.set('pointsPerDollar', String(v));
    return { ok: true, pointsPerDollar: v };
  }
}
