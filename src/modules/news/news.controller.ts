import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { leagueRole } from '../../utils/role';
import { SetNewsHeadlineDto } from './dto/set-news-headline.dto';
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

  /** One post, laid out, with the ones either side of it. */
  @Get(':itemId')
  @LeagueAuth()
  async item(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    const data = await this.newsService.item(leagueId, itemId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'News item retrieved successfully',
      data,
    });
  }

  /** The commissioner replaces, or clears, a generated headline. */
  @Patch(':itemId/headline')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async setHeadline(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() payload: SetNewsHeadlineDto,
  ) {
    const data = await this.newsService.setHeadline(
      leagueId,
      itemId,
      payload.headline ?? null,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Headline updated successfully',
      data,
    });
  }
}
