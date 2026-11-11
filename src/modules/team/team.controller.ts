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
  Put,
  Res,
} from '@nestjs/common';
import { TeamRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentLeague } from '../../common/decorators/current-league.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { leagueRole } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { AssignTeamMemberDto } from './dto/assign-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { SetTeamIntelDto } from './dto/set-team-intel.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamService } from './team.service';

@Controller('leagues/:leagueId/teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @LeagueAuth()
  async list(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.teamService.list(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Teams retrieved successfully',
      data,
    });
  }

  @Post()
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async create(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: CreateTeamDto,
  ) {
    const data = await this.teamService.create(leagueId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Team created successfully',
      data,
    });
  }

  @Patch(':teamId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async update(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() payload: UpdateTeamDto,
  ) {
    const data = await this.teamService.update(leagueId, teamId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team updated successfully',
      data,
    });
  }

  @Delete(':teamId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async remove(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    const data = await this.teamService.remove(leagueId, teamId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team deleted successfully',
      data,
    });
  }

  // PUT, not POST: the body states who should hold the seat, so assigning an
  // empty team and reassigning a taken one are the same request.
  @Put(':teamId/owner')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async assignOwner(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() payload: AssignTeamMemberDto,
  ) {
    const data = await this.teamService.assign(
      leagueId,
      teamId,
      payload.userId,
      TeamRole.owner,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team owner assigned successfully',
      data,
    });
  }

  @Delete(':teamId/owner')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async removeOwner(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    const data = await this.teamService.unassign(
      leagueId,
      teamId,
      TeamRole.owner,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team owner removed successfully',
      data,
    });
  }

  @Put(':teamId/co-owner')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async assignCoOwner(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() payload: AssignTeamMemberDto,
  ) {
    const data = await this.teamService.assign(
      leagueId,
      teamId,
      payload.userId,
      TeamRole.coOwner,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team co-owner assigned successfully',
      data,
    });
  }

  // Every member may call it; the service refuses anybody who does not hold
  // this team. A commissioner may set it on a team's behalf, which is what
  // 'canManageAnyTeam' says.
  @Patch(':teamId/intel')
  @LeagueAuth()
  async setIntel(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() body: SetTeamIntelDto,
    @CurrentUser('id') userId: number,
    @CurrentLeague('canManageAnyTeam') canManageAnyTeam: boolean,
  ) {
    const data = await this.teamService.setIntel(
      leagueId,
      teamId,
      body.status ?? null,
      userId,
      canManageAnyTeam === true,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message:
        body.status === undefined || body.status === null
          ? 'League intel cleared successfully'
          : 'League intel updated successfully',
      data,
    });
  }

  @Delete(':teamId/co-owner')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async removeCoOwner(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    const data = await this.teamService.unassign(
      leagueId,
      teamId,
      TeamRole.coOwner,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Team co-owner removed successfully',
      data,
    });
  }
}
