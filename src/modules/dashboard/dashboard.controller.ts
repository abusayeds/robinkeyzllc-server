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
import { DashboardService } from './dashboard.service';

@Controller('leagues/:leagueId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // Any league member may read any team's front office, the same way the
  // rosters and contracts pages let one team look at another. The caller's id
  // goes down only so the response can say whether this team is theirs, which
  // is what decides whether the page offers actions.
  @Get(':teamId')
  @LeagueAuth()
  async team(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.dashboardService.team(leagueId, teamId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team dashboard retrieved successfully',
      data,
    });
  }
}
