import { Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../../common/errors/appError';
import { Auth } from '../../common/decorators/auth.decorator';
import { role } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { NbaNightlyService } from './nba-nightly.service';
import { NbaSyncService } from './nba-sync.service';

/** Accepts only YYYY-MM-DD, so a stray query string cannot reach the API. */
const isoDate = (value?: string) =>
  value && /^d{4}-d{2}-d{2}$/.test(value) ? value : null;

/**
 * Yesterday in UTC.
 *
 * The nightly job's default: a west-coast game tipping off at 10pm Eastern
 * finishes after midnight UTC, so "today" would miss half the night.
 */
const yesterday = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

// NBA data is global: it belongs to the platform, not to a league, so these
// are super admin routes rather than league ones.
@Controller('nba/sync')
export class NbaController {
  constructor(
    private readonly nbaSyncService: NbaSyncService,
    private readonly nightly: NbaNightlyService,
  ) {}

  @Get('runs')
  @Auth(role.superAdmin)
  async runs(@Res() res: Response) {
    const data = await this.nbaSyncService.history();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Sync history retrieved successfully',
      data,
    });
  }

  @Post('teams')
  @Auth(role.superAdmin)
  async teams(@Res() res: Response) {
    const data = await this.nbaSyncService.syncTeams();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA teams synced successfully',
      data,
    });
  }

  // `cursor` resumes a run that stopped part way; a failed run records the
  // one it reached.
  @Post('players')
  @Auth(role.superAdmin)
  async players(@Res() res: Response, @Query('cursor') cursor?: string) {
    const data = await this.nbaSyncService.syncPlayers(cursor);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA players synced successfully',
      data,
    });
  }

  /**
   * Games between two dates. `?start=YYYY-MM-DD&end=YYYY-MM-DD`, and a single
   * day is the same date twice.
   */
  @Post('games')
  @Auth(role.superAdmin)
  async games(
    @Res() res: Response,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const from = isoDate(start) ?? yesterday();
    const to = isoDate(end) ?? from;

    const data = await this.nbaSyncService.syncGames(from, to);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA games synced successfully',
      data,
    });
  }

  /**
   * One night's player lines. Defaults to yesterday, which is what the
   * nightly job wants: last night's games are final by the time it runs.
   */
  @Post('stats')
  @Auth(role.superAdmin)
  async stats(@Res() res: Response, @Query('date') date?: string) {
    const data = await this.nbaSyncService.syncStats(
      isoDate(date) ?? yesterday(),
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA player stats synced successfully',
      data,
    });
  }

  /** Whether the nightly job is wired, and what it has left to do. */
  @Get('nightly')
  @Auth(role.superAdmin)
  async nightlyStatus(@Res() res: Response) {
    const data = await this.nightly.status();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Nightly sync status retrieved successfully',
      data,
    });
  }

  /**
   * Runs the nightly job now.
   *
   * Every step of it is safe to repeat, which is what makes this a button
   * rather than something to be careful with.
   */
  @Post('nightly')
  @Auth(role.superAdmin)
  async runNightly(@Res() res: Response) {
    await this.nightly.run();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Nightly sync completed',
      data: await this.nightly.status(),
    });
  }

  /**
   * Walks a date range, games then every night's lines.
   *
   * `?start=YYYY-MM-DD&end=YYYY-MM-DD`, and both are required: a backfill
   * with a guessed range is a lot of requests in the wrong place.
   */
  @Post('backfill')
  @Auth(role.superAdmin)
  async backfill(
    @Res() res: Response,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const from = isoDate(start);
    const to = isoDate(end);

    if (!from || !to) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A backfill needs both start and end as YYYY-MM-DD.',
      );
    }

    const data = await this.nbaSyncService.backfill(from, to);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Backfill completed',
      data,
    });
  }

  /** Who is hurt right now. Replaces the whole board each run. */
  @Post('injuries')
  @Auth(role.superAdmin)
  async injuries(@Res() res: Response) {
    const data = await this.nbaSyncService.syncInjuries();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA injuries synced successfully',
      data,
    });
  }
}
