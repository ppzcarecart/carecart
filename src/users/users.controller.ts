import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
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
  private readonly logger = new Logger(UsersController.name);

  constructor(private users: UsersService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  async list(@CurrentUser() actor: any, @Query('role') role?: Role) {
    const all = await this.users.list(role ? { role } : undefined);
    // Managers don't see admin accounts.
    if (actor.role === Role.MANAGER) {
      return all.filter((u) => u.role !== Role.ADMIN);
    }
    return all;
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  create(@CurrentUser() actor: any, @Body() dto: CreateUserDto) {
    if (actor.role === Role.MANAGER && dto.role === Role.ADMIN) {
      throw new ForbiddenException('Managers cannot create admin accounts');
    }
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
  async update(
    @Param('id') id: string,
    @CurrentUser() actor: any,
    @Body() dto: UpdateUserDto,
  ) {
    // Diagnostic: confirms the PATCH actually reaches the controller
    // after the auth + role guards. Logs the actor + target + the
    // dto keys (so we can tell if ValidationPipe is keeping `active`
    // on the way through). The roleExpiresAt + roleBeforeOverride
    // fields are called out explicitly so a "permanent (no expiry)"
    // bug shows up as e.g. `roleExpiresAt=undefined` here.
    this.logger.log(
      `PATCH /api/users/${id} actor=${actor.email} (${actor.role}) body=${JSON.stringify(dto)} roleExpiresAt=${(dto as any).roleExpiresAt} hasOwn=${Object.prototype.hasOwnProperty.call(dto, 'roleExpiresAt')}`,
    );
    if (actor.role === Role.MANAGER) {
      const target = await this.users.findById(id);
      if (target?.role === Role.ADMIN) {
        throw new ForbiddenException('Managers cannot edit admin accounts');
      }
      if (dto.role === Role.ADMIN) {
        throw new ForbiddenException('Managers cannot promote to admin');
      }
    }
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
