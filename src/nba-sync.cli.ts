import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { NbaSyncService } from './modules/nba/nba-sync.service';

/**
 * Runs an NBA sync from the command line.
 *
 * The HTTP routes need a Super Admin token, which a scheduled job will not
 * have, and the client's rule book expects these to run nightly. This boots
 * the application without the HTTP layer and calls the same service, so the
 * command and the route can never drift apart.
 *
 *   npm run sync:nba            teams, then players
 *   npm run sync:nba -- teams   just the teams
 */
async function main() {
  const logger = new Logger('NbaSyncCli');
  const what = process.argv[2] ?? 'all';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const sync = app.get(NbaSyncService);

    if (what === 'all' || what === 'teams') {
      logger.log('Syncing NBA teams…');
      const run = await sync.syncTeams();
      logger.log(
        `Teams: ${run.created} created, ${run.updated} updated, ${run.skipped} skipped`,
      );
    }

    // Players point at teams, so this order matters: a player synced first
    // would have no team to point at.
    if (what === 'all' || what === 'players') {
      logger.log(
        'Syncing NBA players… this walks every page, so give it a minute.',
      );
      const run = await sync.syncPlayers();
      logger.log(
        `Players: ${run.created} created, ${run.updated} updated, ${run.skipped} skipped`,
      );
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
