import { Injectable } from '@nestjs/common';
import {
  PaymentInitInput,
  PaymentInitResult,
  PaymentProvider,
  PaymentWebhookEvent,
} from './payment-provider.interface';

/**
 * Placeholder for the second payment gateway. Replace `init` with the real
 * gateway's API call (e.g. createPaymentSession / createOrder) when the
 * integrator provides credentials and docs.
 */
@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly name = 'manual';

  async init(input: PaymentInitInput): Promise<PaymentInitResult> {
    return {
      provider: 'manual',
      reference: `manual_${input.orderId}`,
      status: 'pending',
    };
  }

  async parseWebhook(rawBody: Buffer | string, headers: Record<string, any>): Promise<PaymentWebhookEvent> {
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    return {
      type: body.type || 'unknown',
      reference: body.reference || '',
      orderId: body.orderId,
      succeeded: !!body.succeeded,
      raw: body,
    };
  }
}
