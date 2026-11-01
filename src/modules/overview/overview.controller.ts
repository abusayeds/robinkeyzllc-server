import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { OverviewService } from './overview.service';

@Controller('leagues/:leagueId/overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @LeagueAuth()
  async league(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.overviewService.league(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League overview retrieved successfully',
      data,
    });
  }
}
