import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { CollectionModule } from './collection/collection.module';
import { PaymentsModule } from './payments/payments.module';
import { PointsModule } from './points/points.module';
import { UploadsModule } from './uploads/uploads.module';
import { SettingsModule } from './settings/settings.module';
import { FulfilmentModule } from './fulfilment/fulfilment.module';
import { ViewsModule } from './views/views.module';
import { BootstrapService } from './bootstrap.service';
import { HealthController } from './health.controller';
import { SamplesService } from './database/samples.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: true, // dev convenience; switch to migrations for prod
        retryAttempts: 10,
        retryDelay: 3000,
        ssl:
          config.get<string>('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/static',
    }),
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    CollectionModule,
    PaymentsModule,
    PointsModule,
    UploadsModule,
    SettingsModule,
    FulfilmentModule,
    ViewsModule,
  ],
  controllers: [HealthController],
  providers: [BootstrapService, SamplesService],
})
export class AppModule {}
