import { Module } from '@nestjs/common';

import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeProvider } from './providers/stripe.provider';
import { ManualProvider } from './providers/manual.provider';
import { OrdersModule } from '../orders/orders.module';
import { CartModule } from '../cart/cart.module';
import { UsersModule } from '../users/users.module';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [OrdersModule, CartModule, UsersModule, PointsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeProvider, ManualProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
