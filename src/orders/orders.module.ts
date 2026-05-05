import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ProductsModule } from '../products/products.module';
import { CartModule } from '../cart/cart.module';
import { PointsModule } from '../points/points.module';
import { PaymentProvidersModule } from '../payments/providers/payment-providers.module';
import { PackingsModule } from '../packings/packings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    ProductsModule,
    CartModule,
    PointsModule,
    PaymentProvidersModule,
    PackingsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
