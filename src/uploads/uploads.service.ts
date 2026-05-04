import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly logger = new Logger(UploadsService.name);
  readonly uploadDir: string;

  constructor(private config: ConfigService) {
    this.uploadDir = this.resolveDir();
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  /**
   * Boot-time diagnostic: prove the configured upload directory exists,
   * is writable, and shows what's already in it. Lets you tell at a
   * glance from the Railway logs whether UPLOAD_DIR is pointing at a
   * mounted volume (file count carries over across deploys) or at a
   * fresh ephemeral path (count resets to 0 every boot).
   */
  async onModuleInit() {
    let exists = false;
    let writable = false;
    let fileCount = 0;
    let isSymlink = false;
    try {
      const stat = fs.statSync(this.uploadDir);
      exists = stat.isDirectory();
      try {
        const link = fs.lstatSync(this.uploadDir);
        isSymlink = link.isSymbolicLink();
      } catch {}
    } catch {}
    if (exists) {
      try {
        const probe = path.join(
          this.uploadDir,
          `.write-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        writable = true;
      } catch {}
      try {
        fileCount = fs.readdirSync(this.uploadDir).filter((f) => !f.startsWith('.')).length;
      } catch {}
    }
    const summary =
      `uploadDir=${this.uploadDir} exists=${exists} writable=${writable}` +
      ` symlink=${isSymlink} persistedFiles=${fileCount}`;
    if (exists && writable) {
      this.logger.log(summary);
    } else {
      // Bad combo: either the dir doesn't exist, or it does but isn't
      // writable. Both will silently fail subsequent uploads, so warn
      // loudly so it shows up in Railway's log highlights.
      this.logger.warn(`UPLOAD DIR PROBLEM — ${summary}`);
    }
  }

  private resolveDir() {
    const raw = this.config.get<string>('UPLOAD_DIR') || './uploads';
    // Some env-var UIs (Railway, certain shells) preserve surrounding
    // quotes verbatim — UPLOAD_DIR='"/app/media"' would arrive here
    // as the literal 5-char prefix `"/app`, which path.isAbsolute then
    // rejects, sending the file silently to /app/"/app/... Defensively
    // strip a single matched pair of leading/trailing quotes plus any
    // surrounding whitespace before resolving.
    // Strip leading and trailing quote characters independently — the
    // earlier matched-pair regex didn't fire when only one end had a
    // stray quote (e.g. UPLOAD_DIR="/app/media/upload missing the
    // closing "), leaving the raw value with a leading " that broke
    // path.isAbsolute and silently mis-rooted the upload dir.
    const dir = raw
      .trim()
      .replace(/^['"]+/, '')
      .replace(/['"]+$/, '')
      .trim();
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
