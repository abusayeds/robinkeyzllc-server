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
import { SetSlotDto } from './dto/set-slot.dto';
import { RosterService } from './roster.service';

@Controller('leagues/:leagueId/rosters')
export class RosterController {
  constructor(private readonly rosterService: RosterService) {}

  // Every member can see the league's rosters; only the commissioner pages
  // link to this one, but the data itself is not private within the league.
  @Get()
  @LeagueAuth()
  async list(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.rosterService.list(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Rosters retrieved successfully',
      data,
    });
  }
  @Get(':teamId')
  @LeagueAuth()
  async team(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    const data = await this.rosterService.team(leagueId, teamId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Roster retrieved successfully',
      data,
    });
  }

  // @LeagueAuth() proves league membership only. Whether this caller may
  // touch THIS team is the service's question, because the answer is "its
  // owner, or a commissioner" and a guard cannot express that.
  @Patch(':teamId/players/:leaguePlayerId/slot')
  @LeagueAuth()
  async setSlot(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('leaguePlayerId', ParseIntPipe) leaguePlayerId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: SetSlotDto,
  ) {
    const data = await this.rosterService.setSlot(
      leagueId,
      teamId,
      leaguePlayerId,
      payload.slotType,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Roster updated successfully',
      data,
    });
  }
}
