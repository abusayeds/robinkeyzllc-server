import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, extname, join, normalize } from 'path';
import { AppError } from '../../common/errors/appError';
import {
  ALLOWED_EXTENSIONS,
  UPLOAD_DIR,
  UPLOAD_PUBLIC_PREFIX,
  UPLOAD_ROOT,
  UPLOAD_SUBDIR,
} from './upload.constants';
import { TUploadedFile } from './upload.types';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  ensureUploadDir() {
    if (!existsSync(UPLOAD_DIR)) {
      mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }
  buildStoredName(originalName: string) {
    const extension = extname(basename(originalName)).toLowerCase();

    const slug = basename(originalName, extname(originalName))
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    const unique = `${Date.now()}-${randomBytes(4).toString('hex')}`;

    return `${unique}${slug ? `-${slug}` : ''}${extension}`;
  }

  toPublicPath(storedName: string) {
    return `${UPLOAD_PUBLIC_PREFIX}/${UPLOAD_SUBDIR}/${storedName}`;
  }

  buildResult(file: Express.Multer.File, baseUrl: string): TUploadedFile {
    const path = this.toPublicPath(file.filename);

    return {
      path,
      url: `${baseUrl}${path}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
  private resolveStoredPath(publicPath: string) {
    const expectedPrefix = `${UPLOAD_PUBLIC_PREFIX}/${UPLOAD_SUBDIR}/`;

    if (!publicPath.startsWith(expectedPrefix)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Invalid file path.');
    }

    const storedName = publicPath.slice(expectedPrefix.length);

    if (!storedName || storedName !== basename(storedName)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Invalid file path.');
    }

    if (!ALLOWED_EXTENSIONS.includes(extname(storedName).toLowerCase() as any)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Invalid file path.');
    }

    const absolutePath = normalize(join(UPLOAD_DIR, storedName));

    if (!absolutePath.startsWith(normalize(UPLOAD_ROOT))) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Invalid file path.');
    }

    return absolutePath;
  }

  async removeFile(publicPath: string) {
    const absolutePath = this.resolveStoredPath(publicPath);

    if (!existsSync(absolutePath)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'File not found.');
    }

    await unlink(absolutePath);

    return { path: publicPath, deleted: true };
  }
  async discardFiles(files: Express.Multer.File[]) {
    await Promise.all(
      files.map(async (file) => {
        try {
          await unlink(file.path);
        } catch {
          this.logger.warn(`Could not discard upload: ${file.path}`);
        }
      }),
    );
  }
}
