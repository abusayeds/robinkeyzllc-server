import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { NbaSyncService } from './modules/nba/nba-sync.service';

/**
 * Runs an NBA sync from the command line.
 *
 * The HTTP routes need a Super Admin token, which a scheduled job will not
 * have, and a historical pull runs for minutes — long enough that a proxy in
 * front of the app would time the request out while the work carried on
 * invisibly. This boots the application without the HTTP layer and calls the
 * same services, so the command and the route can never drift apart.
 *
 *   npm run sync:nba                       teams, then players
 *   npm run sync:nba -- teams              just the teams
 *   npm run sync:nba -- players
 *   npm run sync:nba -- injuries
 *   npm run sync:nba -- averages [season]  the feed's published averages
 *   npm run sync:nba -- careers [from]     every season back to a floor
 *   npm run sync:nba -- backfill <from> <to>   games and lines, by date
 *   npm run sync:nba -- full [from]        the whole sequence, in order
 */

/** An NBA season starts in the autumn, so January belongs to last year's. */
const currentSeason = () => {
  const now = new Date();
  return now.getUTCMonth() >= 8
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
};

/** The 1st of October in a season's starting year: before any game of it. */
const seasonOpening = (startYear: number) => `${startYear}-10-01`;

const today = () => new Date().toISOString().slice(0, 10);

const isoDate = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const seasonYear = (value?: string) =>
  value && /^\d{4}$/.test(value) ? Number(value) : null;

async function main() {
  const logger = new Logger('NbaSyncCli');
  const what = process.argv[2] ?? 'all';
  const season = currentSeason();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  /** Every step prints the same line, so a long run reads as a list. */
  const tally = (
    label: string,
    run: { created: number; updated: number; skipped: number },
  ) =>
    logger.log(
      `${label}: ${run.created} created, ${run.updated} updated, ${run.skipped} skipped`,
    );

  try {
    const sync = app.get(NbaSyncService);
    const full = what === 'full';

    if (full || what === 'all' || what === 'teams') {
      logger.log('Syncing NBA teams…');
      tally('Teams', await sync.syncTeams());
    }

    // Players point at teams, so this order matters: a player synced first
    // would have no team to point at.
    if (full || what === 'all' || what === 'players') {
      logger.log(
        'Syncing NBA players… this walks every page, so give it a minute.',
      );
      tally('Players', await sync.syncPlayers());
    }

    // Before the averages: a backfill is what gives the game log the nights
    // from before this deployment started pulling.
    if (full || what === 'backfill') {
      const from = isoDate(process.argv[3]) ?? seasonOpening(season);
      const to = isoDate(process.argv[4]) ?? today();

      logger.log(`Backfilling games and lines, ${from} to ${to}…`);
      const run = await sync.backfill(from, to);
      logger.log(
        `Backfill: ${run.nights} nights, ${run.gamesCreated} games created, ${run.linesCreated} lines created, ${run.linesUpdated} updated`,
      );
      if (run.failedNights.length > 0) {
        logger.warn(
          `These nights failed and can be run again: ${run.failedNights.join(', ')}`,
        );
      }
    }

    if (full || what === 'averages') {
      const target = seasonYear(process.argv[3]) ?? season;
      logger.log(`Syncing ${target} season averages…`);
      tally('Season averages', await sync.syncSeasonAverages(target));
    }

    if (full || what === 'careers') {
      const from = seasonYear(process.argv[3]) ?? undefined;
      logger.log(
        'Syncing career averages… one request per hundred players per season.',
      );
      tally('Careers', await sync.syncCareerAverages(from));
    }

    if (full || what === 'injuries') {
      logger.log('Syncing injuries…');
      tally('Injuries', await sync.syncInjuries());
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

void main();
