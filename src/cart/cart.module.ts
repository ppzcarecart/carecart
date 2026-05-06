import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { FulfilmentModule } from '../fulfilment/fulfilment.module';
import { SettingsModule } from '../settings/settings.module';
import { OrderItem } from '../orders/entities/order-item.entity';

@Module({
  imports: [
    // OrderItem is registered here (separately from OrdersModule, no
    // circular dep) so the cart can count a customer's prior point
    // redemptions before enforcing the per-product redemption cap.
    TypeOrmModule.forFeature([Cart, CartItem, OrderItem]),
    ProductsModule,
    UsersModule,
    FulfilmentModule,
    SettingsModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService, TypeOrmModule],
})
export class CartModule {}
