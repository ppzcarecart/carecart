import { Body, Controller, Get, Post } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CollectionService } from './collection.service';

@Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR, Role.SCANNER)
@Controller('api/collection')
export class CollectionController {
  constructor(private collection: CollectionService) {}

  @Post('scan')
  scan(
    @Body() body: { value: string },
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.collection.scan(body?.value || '', {
      id: user.id,
      role: user.role,
    });
  }

  @Post('mark')
  mark(
    @Body() body: { value: string },
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.collection.markCollected(body?.value || '', {
      id: user.id,
      role: user.role,
    });
  }

  @Get('logs')
  logs(@CurrentUser() user: { id: string; role: Role }) {
    return this.collection.listLogs({ id: user.id, role: user.role });
  }
}
