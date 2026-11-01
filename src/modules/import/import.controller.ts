import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { AppError } from '../../common/errors/appError';
import { leagueRole } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { ResolveImportRowDto } from './dto/resolve-import-row.dto';
import { ImportService } from './import.service';

/** A spreadsheet of a few hundred rows; anything larger is not a roster. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

@Controller('leagues/:leagueId/import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get('template')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async template(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { filename, csv } = await this.importService.template(leagueId);

    // Sent as a file rather than through sendResponse: the browser saves it,
    // and a JSON envelope would have to be unwrapped before it could.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get()
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async current(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.importService.currentPreview(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: data
        ? 'Import preview retrieved successfully'
        : 'No import in progress',
      data,
    });
  }

  @Post('preview')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  // Held in memory: the file is read once and never needed again, so writing
  // it to disk would only leave a roster lying around to clean up.
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async preview(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'No file received. Send the CSV under the field name "file".',
      );
    }

    const data = await this.importService.preview(
      leagueId,
      userId,
      file.originalname,
      file.buffer.toString('utf8'),
    );

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Import preview created successfully',
      data,
    });
  }

  @Patch(':batchId/rows/:rowId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async resolveRow(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('batchId', ParseIntPipe) batchId: number,
    @Param('rowId', ParseIntPipe) rowId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: ResolveImportRowDto,
  ) {
    const data = await this.importService.resolveRow(
      leagueId,
      batchId,
      rowId,
      payload.playerId,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Row matched successfully',
      data,
    });
  }

  @Post(':batchId/confirm')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async confirm(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('batchId', ParseIntPipe) batchId: number,
  ) {
    const data = await this.importService.confirm(leagueId, batchId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Import confirmed successfully',
      data,
    });
  }

  @Delete(':batchId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async cancel(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('batchId', ParseIntPipe) batchId: number,
  ) {
    await this.importService.cancel(leagueId, batchId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Import discarded successfully',
      data: null,
    });
  }
}
