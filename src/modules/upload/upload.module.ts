import { HttpStatus, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AppError } from '../../common/errors/appError';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
} from './upload.constants';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

const uploadService = new UploadService();

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          uploadService.ensureUploadDir();
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          cb(null, uploadService.buildStoredName(file.originalname));
        },
      }),
      fileFilter: (_req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();

        if (!ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
          return cb(
            new AppError(
              HttpStatus.BAD_REQUEST,
              `File type ${file.mimetype} is not allowed.`,
            ),
            false,
          );
        }

        if (!ALLOWED_EXTENSIONS.includes(extension as any)) {
          return cb(
            new AppError(
              HttpStatus.BAD_REQUEST,
              `File extension ${extension || '(none)'} is not allowed.`,
            ),
            false,
          );
        }

        cb(null, true);
      },
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
