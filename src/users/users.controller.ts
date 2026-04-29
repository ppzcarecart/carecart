import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  list(@Query('role') role?: Role) {
    return this.users.list(role ? { role } : undefined);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.createUser({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      contact: dto.contact,
      role: dto.role,
      address: dto.address,
      vendorStoreName: dto.vendorStoreName,
    });
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto as any);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  // Bulk import customers from CSV (multipart/form-data with field "file")
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('CSV file is required (field "file")');
    const csv = file.buffer.toString('utf8');
    return this.users.bulkImportCustomers(csv);
  }

  // Self-update profile
  @Patch('me')
  updateMe(@CurrentUser() user: any, @Body() dto: UpdateUserDto) {
    // prevent role escalation via /me
    delete (dto as any).role;
    delete (dto as any).active;
    return this.users.update(user.id, dto as any);
  }
}
