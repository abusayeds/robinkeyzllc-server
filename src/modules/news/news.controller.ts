import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { NewsService } from './news.service';

@Controller('leagues/:leagueId/news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  /**
   * The league's news, newest first.
   *
   * The caller's id goes down because two of the four streams are personal:
   * an announcement is held per member, and a move is marked as theirs or not.
   */
  @Get()
  @LeagueAuth()
  async feed(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.newsService.feed(leagueId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League news retrieved successfully',
      data,
    });
  }
}
