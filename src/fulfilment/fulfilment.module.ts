import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../users/entities/user.entity';
import { SettingsModule } from '../settings/settings.module';
import { FulfilmentService } from './fulfilment.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SettingsModule],
  providers: [FulfilmentService],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
