import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { SetSlotDto } from './dto/set-slot.dto';
import { OfferExtensionDto } from './dto/offer-extension.dto';
import { WaivePlayerDto } from './dto/waive-player.dto';
import { RosterService } from './roster.service';
import { ExtensionService } from './extension.service';
import { WaiveService } from './waive.service';

@Controller('leagues/:leagueId/rosters')
export class RosterController {
  constructor(
    private readonly rosterService: RosterService,
    private readonly waiveService: WaiveService,
    private readonly extensionService: ExtensionService,
  ) {}

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

  // What it would cost, before anything is written. The screen asks for this
  // to fill its confirmation, so the owner sees the figure and the stretch
  // alternative before choosing either.
  @Get(':teamId/players/:leaguePlayerId/waive-preview')
  @LeagueAuth()
  async waivePreview(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('leaguePlayerId', ParseIntPipe) leaguePlayerId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.waiveService.preview(
      leagueId,
      teamId,
      leaguePlayerId,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Waive cost retrieved successfully',
      data,
    });
  }

  // Same permission question as the slot route, and for the same reason: its
  // owner, or a commissioner.
  @Post(':teamId/players/:leaguePlayerId/waive')
  @LeagueAuth()
  async waive(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('leaguePlayerId', ParseIntPipe) leaguePlayerId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: WaivePlayerDto,
  ) {
    const data = await this.waiveService.waive(
      leagueId,
      teamId,
      leaguePlayerId,
      payload.stretch ?? false,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `${data.playerName} was waived successfully`,
      data,
    });
  }

  // Rules 10.7 and 10.8 — what an extension may be worth, and why not when it
  // cannot be offered. A refusal comes back as a field rather than an error:
  // the screen has to say why the button is disabled.
  @Get(':teamId/players/:leaguePlayerId/extension')
  @LeagueAuth()
  async extensionLimits(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('leaguePlayerId', ParseIntPipe) leaguePlayerId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.extensionService.limits(
      leagueId,
      teamId,
      leaguePlayerId,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Extension limits retrieved successfully',
      data,
    });
  }

  @Post(':teamId/players/:leaguePlayerId/extension')
  @LeagueAuth()
  async offerExtension(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('leaguePlayerId', ParseIntPipe) leaguePlayerId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: OfferExtensionDto,
  ) {
    const data = await this.extensionService.offer(
      leagueId,
      teamId,
      leaguePlayerId,
      // The DTO leaves optionType off when nothing was chosen; the rules
      // read it as an explicit null.
      payload.years.map((year) => ({
        seasonStartYear: year.seasonStartYear,
        salary: year.salary,
        optionType: year.optionType ?? null,
      })),
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `${data.playerName} was extended successfully`,
      data,
    });
  }
}
