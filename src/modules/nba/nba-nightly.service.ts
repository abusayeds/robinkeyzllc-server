import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeekPhase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BalldontlieClient } from './balldontlie.client';
import { NbaSyncService } from './nba-sync.service';
import { SettleService } from '../scoring/settle.service';

/**
 * 10am UTC — about 5am Eastern, by which time a west-coast game that tipped
 * off at 10pm Eastern is long finished and balldontlie has its final lines.
 */
const NIGHTLY = '0 10 * * *';

/** How many nights back to re-pull, to catch a line balldontlie revised. */
const BACKFILL_NIGHTS = 2;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const daysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};

@Injectable()
export class NbaNightlyService {
  private readonly logger = new Logger(NbaNightlyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bdl: BalldontlieClient,
    private readonly syncService: NbaSyncService,
    private readonly settleService: SettleService,
  ) {}

  /**
   * Last night's games and lines, then any league week that has finished.
   *
   * In-process rather than on a queue: it is one job a day, every step of it
   * is safe to repeat, and a missed night is fixed by asking for that date
   * again. A broker would add a thing to keep running for no gain.
   */
  @Cron(NIGHTLY, { name: 'nba-nightly' })
  async run() {
    if (!this.bdl.isConfigured) {
      // Said once a night at debug rather than warn: a deployment without a
      // key is a normal state before the client's subscription is wired, and
      // a nightly warning would train everyone to ignore warnings.
      this.logger.debug('No balldontlie key configured; nightly sync skipped.');
      return;
    }

    try {
      await this.syncRecentNights();
      await this.settleFinishedWeeks();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown nightly failure';
      // Swallowed on purpose: an unhandled rejection inside a cron takes the
      // process with it, and every step has already written its own SyncRun
      // row saying what happened.
      this.logger.error(`Nightly sync failed: ${message}`);
    }
  }

  /**
   * The last couple of nights, not just yesterday.
   *
   * balldontlie does revise a line after the fact, and re-pulling a date
   * replaces the rows rather than adding to them, so the cheapest way to pick
   * up a correction is to ask again.
   */
  private async syncRecentNights() {
    const from = isoDate(daysAgo(BACKFILL_NIGHTS));
    const to = isoDate(daysAgo(1));

    await this.syncService.syncGames(from, to);

    for (let back = BACKFILL_NIGHTS; back >= 1; back -= 1) {
      await this.syncService.syncStats(isoDate(daysAgo(back)));
    }

    this.logger.log(`Synced NBA games and lines for ${from} to ${to}.`);
  }

  /**
   * Settles every finished week in every league that has a schedule.
   *
   * A week is settled the day after it ends, which is what makes the stored
   * snapshot the right answer rather than an approximation: the rosters it
   * reads are still the rosters that played it.
   */
  private async settleFinishedWeeks() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Only leagues with a week actually waiting, so a league between seasons
    // costs nothing.
    const due = await this.prisma.scheduleWeek.findMany({
      where: { isSettled: false, endDate: { lt: today } },
      distinct: ['leagueId', 'seasonStartYear'],
      select: { leagueId: true, seasonStartYear: true },
    });

    for (const row of due) {
      try {
        const result = await this.settleService.settleDue(
          row.leagueId,
          row.seasonStartYear,
        );
        if (result.settled.length) {
          this.logger.log(
            `League ${row.leagueId}: settled week(s) ${result.settled.join(', ')}.`,
          );
        }
      } catch (error) {
        // One league's bad week must not stop the others being settled.
        const message =
          error instanceof Error ? error.message : 'Unknown settle failure';
        this.logger.error(`League ${row.leagueId} settle failed: ${message}`);
      }
    }
  }

  /**
   * What the Super Admin screen shows beside the manual buttons: whether the
   * job has anything to do and when it last did it.
   */
  async status() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [lastGames, lastStats, weeksDue, playoffWeeksDue] = await Promise.all(
      [
        this.prisma.syncRun.findFirst({
          where: { job: 'games' },
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.syncRun.findFirst({
          where: { job: 'stats' },
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.scheduleWeek.count({
          where: {
            isSettled: false,
            endDate: { lt: today },
            phase: WeekPhase.regular,
          },
        }),
        this.prisma.scheduleWeek.count({
          where: {
            isSettled: false,
            endDate: { lt: today },
            phase: WeekPhase.playoffs,
          },
        }),
      ],
    );

    return {
      schedule: NIGHTLY,
      backfillNights: BACKFILL_NIGHTS,
      keyConfigured: this.bdl.isConfigured,
      lastGamesSync: lastGames,
      lastStatsSync: lastStats,
      weeksAwaitingSettlement: weeksDue + playoffWeeksDue,
    };
  }
}
