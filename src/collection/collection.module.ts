import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CollectionLog } from './entities/collection-log.entity';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { PackingsModule } from '../packings/packings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, CollectionLog]),
    PackingsModule,
  ],
  controllers: [CollectionController],
  providers: [CollectionService],
  exports: [CollectionService, TypeOrmModule],
})
export class CollectionModule {}
