import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { leagueRole } from '../../utils/role';
import { MatchupService } from './matchup.service';
import { ScheduleService } from './schedule.service';
import { SettleService } from './settle.service';
import { StandingsService } from './standings.service';

/** Drawing or settling a season is commissioner work. */
const MANAGERS = [leagueRole.commissioner, leagueRole.coCommissioner] as const;

/** Accepts only YYYY-MM-DD, so a stray query string cannot reach a query. */
const isoDate = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : undefined;

const weekNumber = (value?: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

@Controller('leagues/:leagueId/standings')
export class StandingsController {
  constructor(
    private readonly standingsService: StandingsService,
    private readonly scheduleService: ScheduleService,
  ) {}

  /**
   * Everything the standings screen opens with: the table, the current week,
   * and how far through the season the league is.
   *
   * One request for the two tabs that share a table — Conference splits the
   * same rows the League tab shows combined, so fetching it twice would only
   * risk the two disagreeing.
   */
  @Get()
  @LeagueAuth()
  async table(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { season, seasonStartYear } =
      await this.standingsService.seasonOf(leagueId);

    const [rows, weeks, current] = await Promise.all([
      this.standingsService.table(leagueId, seasonStartYear),
      this.scheduleService.weeks(leagueId, seasonStartYear),
      this.scheduleService.currentWeek(leagueId, seasonStartYear),
    ]);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Standings retrieved successfully',
      data: {
        season,
        seasonStartYear,
        week: current?.weekNumber ?? 0,
        weeks: weeks.map((week) => ({
          weekNumber: week.weekNumber,
          startDate: week.startDate,
          endDate: week.endDate,
          phase: week.phase,
          isSettled: week.isSettled,
        })),
        settledWeeks: weeks.filter((week) => week.isSettled).length,
        standings: rows,
      },
    });
  }

  /**
   * Category totals for a week, a range, or the season so far.
   *
   * `?week=12` is the screen's "By Period", `?from=&to=` its "By Date", and
   * neither is year to date. The three are one endpoint because they differ
   * only in which weeks are added up.
   */
  @Get('categories')
  @LeagueAuth()
  async categories(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query('week') week?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { seasonStartYear } = await this.standingsService.seasonOf(leagueId);

    const [rows, h2h] = await Promise.all([
      this.standingsService.categoryTotals(leagueId, seasonStartYear, {
        weekNumber: weekNumber(week),
        from: isoDate(from),
        to: isoDate(to),
      }),
      this.standingsService.h2hWins(leagueId, seasonStartYear),
    ]);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Category totals retrieved successfully',
      data: {
        seasonStartYear,
        categories: this.standingsService.categories(),
        teams: rows.map((row) => ({
          ...row,
          h2hWins: h2h.get(row.teamId) ?? 0,
        })),
      },
    });
  }

  @Get('playoffs')
  @LeagueAuth()
  async playoffs(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { season, seasonStartYear } =
      await this.standingsService.seasonOf(leagueId);

    const data = await this.standingsService.playoffs(
      leagueId,
      seasonStartYear,
      season,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Playoff bracket retrieved successfully',
      data,
    });
  }
}

@Controller('leagues/:leagueId/schedule')
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly settleService: SettleService,
    private readonly standingsService: StandingsService,
    private readonly matchupService: MatchupService,
  ) {}

  @Get()
  @LeagueAuth()
  async weeks(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { seasonStartYear } = await this.standingsService.seasonOf(leagueId);

    const [weeks, current] = await Promise.all([
      this.scheduleService.weeks(leagueId, seasonStartYear),
      this.scheduleService.currentWeek(leagueId, seasonStartYear),
    ]);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Schedule retrieved successfully',
      data: {
        seasonStartYear,
        currentWeek: current?.weekNumber ?? 0,
        weeks,
      },
    });
  }

  /**
   * Every matchup of the season, with the teams and their records.
   *
   * One request: the week cards and the full-season grid are the same rows,
   * and fetching them twice would only risk the two disagreeing.
   */
  @Get('matchups')
  @LeagueAuth()
  async matchups(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { seasonStartYear } = await this.standingsService.seasonOf(leagueId);

    const [data, current] = await Promise.all([
      this.matchupService.list(leagueId, seasonStartYear),
      this.scheduleService.currentWeek(leagueId, seasonStartYear),
    ]);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Matchups retrieved successfully',
      data: { seasonStartYear, currentWeek: current?.weekNumber ?? 0, ...data },
    });
  }

  /** One matchup, nine categories side by side and every player line. */
  @Get('matchups/:matchupId')
  @LeagueAuth()
  async matchup(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('matchupId', ParseIntPipe) matchupId: number,
  ) {
    const data = await this.matchupService.detail(leagueId, matchupId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Matchup retrieved successfully',
      data,
    });
  }
  /**
   * Draws the season. Destructive, and refused once a week has been settled —
   * see the service.
   */
  @Post('generate')
  @LeagueAuth(...MANAGERS)
  async generate(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const data = await this.scheduleService.generate(leagueId, {
      startDate: start,
      endDate: end,
    });

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Schedule generated successfully',
      data,
    });
  }

  /** Settles every week that has ended and has not been settled. */
  @Post('settle')
  @LeagueAuth(...MANAGERS)
  async settle(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const { seasonStartYear } = await this.standingsService.seasonOf(leagueId);
    const data = await this.settleService.settleDue(leagueId, seasonStartYear);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Weeks settled successfully',
      data,
    });
  }

  /**
   * One week, by force if it has already been settled.
   *
   * There for a corrected box score, which balldontlie does occasionally
   * revise, and not for ordinary use.
   */
  @Post('weeks/:weekId/settle')
  @LeagueAuth(...MANAGERS)
  async settleOne(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('weekId', ParseIntPipe) weekId: number,
    @Query('force') force?: string,
  ) {
    const data = await this.settleService.settleWeek(
      leagueId,
      weekId,
      force === 'true',
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Week settled successfully',
      data,
    });
  }
}
