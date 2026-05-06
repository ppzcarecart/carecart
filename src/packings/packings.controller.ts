import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { PackingsService } from './packings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/packings')
export class PackingsController {
  constructor(private readonly packings: PackingsService) {}

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/pack')
  async pack(@Param('id') id: string, @CurrentUser() user: any) {
    if (!id) throw new BadRequestException('id required');
    const updated = await this.packings.markPacked(id, {
      id: user.id,
      role: user.role,
    });
    return { id: updated.id, status: updated.status, packedAt: updated.packedAt };
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/forfeit')
  async forfeit(@Param('id') id: string, @CurrentUser() user: any) {
    if (!id) throw new BadRequestException('id required');
    const result = await this.packings.markForfeit(id, {
      id: user.id,
      role: user.role,
    });
    return {
      id: result.packing.id,
      status: result.packing.status,
      forfeitedAt: result.packing.forfeitedAt,
      orderNumbers: result.orderNumbers,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/ship')
  async ship(@Param('id') id: string, @CurrentUser() user: any) {
    if (!id) throw new BadRequestException('id required');
    const result = await this.packings.markShipped(id, {
      id: user.id,
      role: user.role,
    });
    return {
      id: result.packing.id,
      status: result.packing.status,
      shippedAt: result.packing.shippedAt,
      orderNumbers: result.orderNumbers,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post('customer/:customerId/pack')
  async packAllForCustomer(
    @Param('customerId') customerId: string,
    @CurrentUser() user: any,
  ) {
    if (!customerId) throw new BadRequestException('customerId required');
    const result = await this.packings.markAllPackedForCustomer(customerId, {
      id: user.id,
      role: user.role,
    });
    return result;
  }
}
