import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Auth } from '../../common/decorators/auth.decorator';
import { AppError } from '../../common/errors/appError';
import { role } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { ImportBirthdatesDto } from './dto/import-birthdates.dto';
import { SearchPlayerDto } from './dto/search-player.dto';
import { PlayerService } from './player.service';

/** Two columns for every player in the league; anything larger is not that. */
const MAX_UPLOAD_BYTES = 1024 * 1024;

// Players are global: the same row serves every league, so these routes carry
// @Auth() rather than @LeagueAuth(). Nothing here is league data.
@Controller('players')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  // Declared before the ':playerId' route below, or 'search' is read as an id.
  @Get('search')
  @Auth()
  async search(@Res() res: Response, @Query() query: SearchPlayerDto) {
    const data = await this.playerService.search(query.q, query.limit);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Players retrieved successfully',
      data,
    });
  }

  // Also declared before ':playerId', for the same reason.
  @Get('birthdates/template')
  @Auth(role.superAdmin)
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="player-birthdates.csv"',
    );
    // Header only. An example row in a template gets imported by accident.
    res.send('player,birthdate\n');
  }

  @Post('birthdates')
  @Auth(role.superAdmin)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async importBirthdates(
    @Res() res: Response,
    @Query() query: ImportBirthdatesDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'No file received. Send the CSV under the field name "file".',
      );
    }

    const data = await this.playerService.importBirthdates(
      file.buffer.toString('utf8'),
      query.dryRun ?? false,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: data.dryRun
        ? 'Birthdate file checked successfully'
        : 'Birthdates imported successfully',
      data,
    });
  }

  @Get(':playerId')
  @Auth()
  async findOne(
    @Res() res: Response,
    @Param('playerId', ParseIntPipe) playerId: number,
  ) {
    const data = await this.playerService.findOne(playerId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Player retrieved successfully',
      data,
    });
  }
}
