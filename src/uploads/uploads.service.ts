import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  readonly uploadDir: string;

  constructor(private config: ConfigService) {
    this.uploadDir = this.resolveDir();
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  private resolveDir() {
    const dir = this.config.get<string>('UPLOAD_DIR') || './uploads';
    if (path.isAbsolute(dir)) return dir;
    return path.join(process.cwd(), dir);
  }

  /**
   * Save a Multer file to disk under the configured upload dir and return
   * a public URL the storefront can render.
   */
  save(file: Express.Multer.File): { url: string; filename: string } {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    const dest = path.join(this.uploadDir, name);
    fs.writeFileSync(dest, file.buffer);
    return { filename: name, url: `/uploads/${name}` };
  }

  resolvePath(filename: string) {
    const safe = path.basename(filename);
    return path.join(this.uploadDir, safe);
  }
}
