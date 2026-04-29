import { Controller, Get } from '@nestjs/common';
import { PointsService } from './points.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/points')
export class PointsController {
  constructor(private points: PointsService) {}

  @Get('balance')
  balance(@CurrentUser() user: any) {
    return this.points.getBalance(user.id);
  }
}
