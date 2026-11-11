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
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { role } from '../../utils/role';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { leagueRole } from '../../utils/role';
import {
  CreateCalendarEventDto,
  ListCalendarDto,
  UpdateCalendarEventDto,
} from './dto/calendar-event.dto';
import { AddCoCommissionerDto } from './dto/co-commissioner.dto';
import { CreateLeagueDto } from './dto/create-league.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateLeagueDto } from './dto/update-league.dto';
import { LeagueService } from './league.service';

@Controller('leagues')
export class LeagueController {
  constructor(private readonly leagueService: LeagueService) {}

  @Post()
  @Auth()
  async createLeague(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Body() payload: CreateLeagueDto,
  ) {
    const data = await this.leagueService.createLeague(userId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'League created successfully',
      data,
    });
  }

  @Get('my')
  @Auth()
  async myLeagues(@Res() res: Response, @CurrentUser('id') userId: number) {
    const data = await this.leagueService.myLeagues(userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League list retrieved successfully',
      data,
    });
  }

  // Declared before ':leagueId', or 'all' is read as an id.
  @Get('all')
  @Auth(role.superAdmin)
  async allLeagues(@Res() res: Response) {
    const data = await this.leagueService.allLeagues();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Leagues retrieved successfully',
      data,
    });
  }
  // Everything below is scoped to one league. LeagueGuard reads :leagueId,
  // checks membership, and refuses a role that is not allowed.
  @Get(':leagueId/settings')
  @LeagueAuth()
  async getSettings(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.leagueService.getSettings(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League settings retrieved successfully',
      data,
    });
  }

  @Patch(':leagueId/settings')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async updateSettings(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: UpdateLeagueSettingsDto,
  ) {
    const data = await this.leagueService.updateSettings(leagueId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League settings updated successfully',
      data,
    });
  }

  @Get(':leagueId/members')
  @LeagueAuth()
  async members(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.leagueService.members(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League members retrieved successfully',
      data,
    });
  }

  // Only the commissioner appoints, so a co-commissioner cannot promote
  // others and widen their own circle.
  @Post(':leagueId/co-commissioners')
  @LeagueAuth(leagueRole.commissioner)
  async addCoCommissioner(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: AddCoCommissionerDto,
  ) {
    const data = await this.leagueService.addCoCommissioner(
      leagueId,
      payload,
      userId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Co-commissioner added successfully',
      data,
    });
  }

  @Delete(':leagueId/co-commissioners/:userId')
  @LeagueAuth(leagueRole.commissioner)
  async removeCoCommissioner(
    @Res() res: Response,
    @CurrentUser('id') actingUserId: number,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const data = await this.leagueService.removeCoCommissioner(
      leagueId,
      userId,
      actingUserId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Co-commissioner removed successfully',
      data,
    });
  }

  @Get(':leagueId/calendar')
  @LeagueAuth()
  async calendar(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: ListCalendarDto,
  ) {
    const data = await this.leagueService.calendar(leagueId, query.season);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League calendar retrieved successfully',
      data,
    });
  }

  @Post(':leagueId/calendar')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async createCalendarEvent(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: CreateCalendarEventDto,
  ) {
    const data = await this.leagueService.createCalendarEvent(
      leagueId,
      payload,
    );

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Calendar event created successfully',
      data,
    });
  }

  // Declared before ':eventId' so 'roll-over' is not read as an event id.
  @Post(':leagueId/calendar/roll-over')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async rollOverCalendar(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: ListCalendarDto,
  ) {
    const data = await this.leagueService.rollOverCalendar(
      leagueId,
      query.season,
    );

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Next season calendar created successfully',
      data,
    });
  }

  @Patch(':leagueId/calendar/:eventId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async updateCalendarEvent(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() payload: UpdateCalendarEventDto,
  ) {
    const data = await this.leagueService.updateCalendarEvent(
      leagueId,
      eventId,
      payload,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Calendar event updated successfully',
      data,
    });
  }

  @Delete(':leagueId/calendar/:eventId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async deleteCalendarEvent(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    const data = await this.leagueService.deleteCalendarEvent(
      leagueId,
      eventId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Calendar event deleted successfully',
      data,
    });
  }

  // Declared last so the static 'my' route above is never read as a league id.
  @Patch(':leagueId')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async updateLeague(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() payload: UpdateLeagueDto,
  ) {
    const data = await this.leagueService.updateLeague(leagueId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League updated successfully',
      data,
    });
  }
}
