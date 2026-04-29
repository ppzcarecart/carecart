import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import {
  PaymentInitInput,
  PaymentInitResult,
  PaymentProvider,
  PaymentWebhookEvent,
} from './payment-provider.interface';

/**
 * Stripe PayNow integration using PaymentIntents with payment_method_types: ['paynow'].
 * PayNow is a SGD-only QR payment in Singapore.
 * Customers get a QR (next_action.paynow_display_qr_code) which they scan to pay.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly logger = new Logger(StripeProvider.name);
  private stripe?: Stripe;
  private webhookSecret?: string;
  private currency: string;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.currency = (this.config.get<string>('STRIPE_CURRENCY') || 'sgd').toLowerCase();
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2024-06-20' as any });
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set; Stripe payments will fail until configured');
    }
  }

  async init(input: PaymentInitInput): Promise<PaymentInitResult> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: (input.currency || this.currency).toLowerCase(),
      payment_method_types: ['paynow'],
      description: input.description || `Order ${input.orderNumber}`,
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        ...(input.metadata || {}),
      },
      receipt_email: input.customerEmail,
    });

    return {
      provider: 'stripe',
      reference: intent.id,
      clientSecret: intent.client_secret || undefined,
      status:
        intent.status === 'succeeded'
          ? 'succeeded'
          : intent.status === 'requires_action'
            ? 'requires_action'
            : 'pending',
      raw: intent,
    };
  }

  async parseWebhook(
    rawBody: Buffer | string,
    headers: Record<string, any>,
  ): Promise<PaymentWebhookEvent> {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    if (!this.webhookSecret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET not configured');

    const sig = headers['stripe-signature'];
    if (!sig) throw new BadRequestException('Missing stripe-signature');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody as Buffer, sig, this.webhookSecret);
    } catch (e: any) {
      throw new BadRequestException(`Stripe signature verification failed: ${e.message}`);
    }

    let reference = '';
    let orderId: string | undefined;
    let succeeded = false;

    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.processing' ||
      event.type === 'payment_intent.requires_action'
    ) {
      const intent = event.data.object as Stripe.PaymentIntent;
      reference = intent.id;
      orderId = (intent.metadata?.orderId as string) || undefined;
      succeeded = event.type === 'payment_intent.succeeded';
    }

    return {
      type: event.type,
      reference,
      orderId,
      succeeded,
      raw: event,
    };
  }
}
