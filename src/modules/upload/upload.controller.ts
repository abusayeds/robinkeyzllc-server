import {
  Controller,
  Delete,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { AppError } from '../../common/errors/appError';
import { DeleteFileDto } from './dto/delete-file.dto';
import { MAX_FILES_PER_REQUEST } from './upload.constants';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}
  private baseUrl(req: Request) {
    return `${req.protocol}://${req.get('host')}`;
  }

  @Post()
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @Req() req: Request,
    @Res() res: Response,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'No file received. Send the file under the field name "file".',
      );
    }

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'File uploaded successfully',
      data: this.uploadService.buildResult(file, this.baseUrl(req)),
    });
  }

  @Post('multiple')
  @Auth()
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_REQUEST))
  async uploadMultiple(
    @Req() req: Request,
    @Res() res: Response,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'No files received. Send the files under the field name "files".',
      );
    }

    const baseUrl = this.baseUrl(req);

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: `${files.length} file(s) uploaded successfully`,
      data: files.map((file) => this.uploadService.buildResult(file, baseUrl)),
    });
  }

  @Delete()
  @Auth()
  async deleteFile(@Res() res: Response, @Query() query: DeleteFileDto) {
    const data = await this.uploadService.removeFile(query.path);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'File deleted successfully',
      data,
    });
  }
}
