import { Module } from '@nestjs/common';
import { ViewsController } from './views.controller';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';
import { OrdersModule } from '../orders/orders.module';
import { CartModule } from '../cart/cart.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { CollectionModule } from '../collection/collection.module';

@Module({
  imports: [
    ProductsModule,
    CategoriesModule,
    OrdersModule,
    CartModule,
    UsersModule,
    SettingsModule,
    CollectionModule,
  ],
  controllers: [ViewsController],
})
export class ViewsModule {}
