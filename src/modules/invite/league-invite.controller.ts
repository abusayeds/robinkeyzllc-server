import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { leagueRole } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { CreateLeagueInviteDto } from './dto/create-invite.dto';
import { InviteService } from './invite.service';

/** The commissioner's side: who has been invited to this league. */
@Controller('leagues/:leagueId/invites')
export class LeagueInviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Get()
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async list(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.inviteService.listForLeague(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League invites retrieved successfully',
      data,
    });
  }

  @Post()
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async invite(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: CreateLeagueInviteDto,
    @CurrentUser('id') actingUserId: number,
  ) {
    const data = await this.inviteService.invite(
      leagueId,
      payload.userId,
      actingUserId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Invite sent successfully',
      data,
    });
  }

  @Delete(':userId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async cancel(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const data = await this.inviteService.cancel(leagueId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Invite cancelled successfully',
      data,
    });
  }
}
