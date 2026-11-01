import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { SearchPlayerDto } from './dto/search-player.dto';
import { PlayerService } from './player.service';

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
