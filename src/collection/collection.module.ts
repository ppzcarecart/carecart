import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../orders/entities/order.entity';
import { CollectionLog } from './entities/collection-log.entity';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Order, CollectionLog])],
  controllers: [CollectionController],
  providers: [CollectionService],
  exports: [CollectionService, TypeOrmModule],
})
export class CollectionModule {}
