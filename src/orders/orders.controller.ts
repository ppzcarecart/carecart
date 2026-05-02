import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { OrdersService } from './orders.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { OrderStatus } from './entities/order.entity';

@Controller('api/orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get('mine')
  mine(@CurrentUser() user: any) {
    return this.orders.listForUser(user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  all(
    @Query('status') status?: OrderStatus,
    @Query('vendorId') vendorId?: string,
  ) {
    return this.orders.listAll({ status, vendorId });
  }

  // Vendor: only orders containing the vendor's products
  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor')
  vendorOrders(@CurrentUser() user: any) {
    return this.orders.vendorOrders(user.id);
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/sales')
  vendorSales(@CurrentUser() user: any) {
    return this.orders.vendorSalesSummary(user.id);
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentUser() user: any) {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    // Customers can only see their own; admin/manager can see all; vendor only if they have an item
    if (user.role === Role.CUSTOMER && order.customerId !== user.id) {
      throw new ForbiddenException();
    }
    if (user.role === Role.VENDOR && !order.items.some((i) => i.vendorId === user.id)) {
      throw new ForbiddenException();
    }
    return order;
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: OrderStatus }) {
    return this.orders.setStatus(id, body.status);
  }

  /**
   * Refund the order. Admin/manager can refund any order; vendors can
   * only refund orders that include their items. Refunds PPZ points to
   * the customer via the partner API and locks the status to refunded.
   */
  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: any,
  ) {
    return this.orders.refund(
      id,
      { id: user.id, role: user.role },
      body?.reason ?? '',
    );
  }

  /**
   * Cancel an order that's still awaiting payment. Reverses any
   * pre-redeemed points, cancels the Stripe intent, restores stock,
   * and locks the order to status 'cancelled'. Admin/manager can
   * cancel any pending order; vendors can only cancel orders that
   * include their items.
   */
  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: any,
  ) {
    return this.orders.cancel(
      id,
      { id: user.id, role: user.role },
      body?.reason ?? '',
    );
  }
}
