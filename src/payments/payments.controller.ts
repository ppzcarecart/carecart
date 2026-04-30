import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { CartService } from '../cart/cart.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private orders: OrdersService,
    private cart: CartService,
  ) {}

  /**
   * Convenience: create order from current cart, then start payment in one call.
   */
  @Post('api/checkout')
  async checkout(
    @CurrentUser() user: any,
    @Body()
    body: {
      provider?: string;
      shippingAddress?: Record<string, any>;
      fulfilmentMethod?: 'delivery' | 'collection';
    },
  ) {
    const provider = body.provider || 'stripe';
    const method = body.fulfilmentMethod === 'collection' ? 'collection' : 'delivery';
    const order = await this.orders.createFromCart(
      user.id,
      body.shippingAddress,
      provider,
      method,
    );
    const init = await this.payments.start(order.id, provider);
    return { order, payment: init };
  }

  @Post('api/payments/:orderId/start')
  start(
    @Param('orderId') orderId: string,
    @Body() body: { provider?: string },
  ) {
    return this.payments.start(orderId, body.provider || 'stripe');
  }

  // Stripe webhook: requires raw body for signature verification.
  @Public()
  @Post('api/payments/webhook/stripe')
  @HttpCode(200)
  stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers() headers: any) {
    return this.payments.handleWebhook('stripe', req.rawBody as Buffer, headers);
  }

  // Generic webhook for the future second gateway
  @Public()
  @Post('api/payments/webhook/manual')
  @HttpCode(200)
  manualWebhook(@Req() req: RawBodyRequest<Request>, @Headers() headers: any) {
    return this.payments.handleWebhook('manual', req.rawBody as Buffer, headers);
  }
}
