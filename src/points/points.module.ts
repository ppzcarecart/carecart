import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PointsTransaction } from './entities/points-transaction.entity';
import { PointsService } from './points.service';
import { PointsController } from './points.controller';
import { PointsClient } from './points.client';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([PointsTransaction]), UsersModule],
  controllers: [PointsController],
  providers: [PointsService, PointsClient],
  exports: [PointsService, PointsClient],
})
export class PointsModule {}
