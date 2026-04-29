import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';

import { UploadsService } from './uploads.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post('api/uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    return this.uploads.save(file);
  }

  // Serve files saved on the volume
  @Public()
  @Get('uploads/:filename')
  serve(@Param('filename') filename: string, @Res() res: Response) {
    const p = this.uploads.resolvePath(filename);
    if (!fs.existsSync(p)) {
      res.status(404).send('Not found');
      return;
    }
    res.sendFile(p);
  }
}
