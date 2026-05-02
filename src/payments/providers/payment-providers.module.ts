import { Module } from '@nestjs/common';

import { StripeProvider } from './stripe.provider';
import { ManualProvider } from './manual.provider';

/**
 * Holds the concrete payment provider implementations as Nest
 * providers. Lives in its own module so that both PaymentsModule and
 * OrdersModule can inject them (cancel-order flow) without a
 * circular dependency between the two.
 */
@Module({
  providers: [StripeProvider, ManualProvider],
  exports: [StripeProvider, ManualProvider],
})
export class PaymentProvidersModule {}
