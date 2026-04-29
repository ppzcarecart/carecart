import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { OrdersService } from '../orders/orders.service';
import { StripeProvider } from './providers/stripe.provider';
import { ManualProvider } from './providers/manual.provider';
import { PaymentProvider } from './providers/payment-provider.interface';
import { UsersService } from '../users/users.service';
import { PointsService } from '../points/points.service';

@Injectable()
export class PaymentsService {
  private providers: Record<string, PaymentProvider>;

  constructor(
    private orders: OrdersService,
    private stripeProvider: StripeProvider,
    private manualProvider: ManualProvider,
    private users: UsersService,
    private points: PointsService,
  ) {
    this.providers = {
      stripe: stripeProvider,
      manual: manualProvider,
    };
  }

  getProvider(name: string): PaymentProvider {
    const p = this.providers[name];
    if (!p) throw new BadRequestException(`Unknown payment provider: ${name}`);
    return p;
  }

  /**
   * Begin payment for an existing order. Returns provider-specific data
   * (intent client secret for Stripe PayNow QR confirmation).
   */
  async start(orderId: string, providerName: string) {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const provider = this.getProvider(providerName);

    // If the order has any points-priced lines, pre-redeem them via the points
    // system (idempotent). The points provider stub will no-op until the API
    // base url is configured.
    if (order.pointsTotal > 0 && order.customerId) {
      await this.points.redeem(order.customerId, order.pointsTotal, order.id);
    }

    // If totalCents is 0 (entirely points-priced), skip the gateway and mark paid.
    if (order.totalCents === 0) {
      await this.orders.setPayment(order.id, 'points-only', 'paid');
      return {
        provider: 'points-only',
        reference: 'points-only',
        status: 'succeeded',
        message: 'Order paid with points',
      };
    }

    const customer = order.customerId ? await this.users.findById(order.customerId) : undefined;
    const result = await provider.init({
      orderId: order.id,
      orderNumber: order.number,
      amountCents: order.totalCents,
      currency: order.currency,
      customerEmail: customer?.email,
      customerName: customer?.name,
      description: `ppzshop ${order.number}`,
    });

    await this.orders.setPayment(order.id, result.reference, 'awaiting_payment');
    return result;
  }

  /**
   * Handle a webhook from a provider; mark order paid/failed accordingly.
   */
  async handleWebhook(providerName: string, rawBody: Buffer, headers: Record<string, any>) {
    const provider = this.getProvider(providerName);
    const event = await provider.parseWebhook(rawBody, headers);
    if (!event.orderId) return { received: true };

    if (event.succeeded) {
      await this.orders.setPayment(event.orderId, event.reference, 'paid');
    } else if (event.type.includes('failed')) {
      const order = await this.orders.findById(event.orderId);
      if (order && order.pointsTotal > 0 && order.customerId) {
        await this.points.reverse(order.customerId, order.pointsTotal, order.id);
      }
      await this.orders.setPayment(event.orderId, event.reference, 'cancelled');
    }
    return { received: true };
  }
}
