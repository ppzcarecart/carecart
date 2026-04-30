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

// Settings keys admins/managers can write through the bulk PATCH endpoint.
// Anything not in this list is rejected so untrusted writes can't poison
// arbitrary keys via the API.
const WRITABLE_KEYS = new Set([
  'pointsPerDollar',
  'collection.line1',
  'collection.line2',
  'collection.postalCode',
  'collection.contact',
  'collection.hours',
  'delivery.enabled',
  'delivery.feeCents',
]);

@Controller('api/settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  async getAll() {
    const all = await this.settings.getAll();
    return all;
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

  /** Bulk-update of multiple admin settings in one PATCH. */
  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch()
  async bulkUpdate(@Body() body: Record<string, unknown>) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('body must be an object of key/value');
    }
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!WRITABLE_KEYS.has(k)) {
        throw new BadRequestException(`Unknown or read-only setting: ${k}`);
      }
      updates[k] = v == null ? '' : String(v);
    }
    for (const [k, v] of Object.entries(updates)) {
      await this.settings.set(k, v);
    }
    return { ok: true, updated: Object.keys(updates) };
  }
}
