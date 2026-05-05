import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Packing } from './entities/packing.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { PackingsService } from './packings.service';
import { PackingsController } from './packings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Packing, Order, OrderItem])],
  providers: [PackingsService],
  controllers: [PackingsController],
  exports: [PackingsService, TypeOrmModule],
})
export class PackingsModule {}
