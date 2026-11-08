import { Module } from '@nestjs/common';
import { BalldontlieClient } from './balldontlie.client';
import { NbaController } from './nba.controller';
import { NbaNightlyService } from './nba-nightly.service';
import { NbaSyncService } from './nba-sync.service';
import { PlayerStatsService } from './player-stats.service';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  // The nightly job settles league weeks once it has the lines, so it needs
  // the scoring module. Imported rather than made global: this is the only
  // place outside the scoring module itself that settles anything.
  imports: [ScoringModule],
  controllers: [NbaController],
  providers: [
    BalldontlieClient,
    NbaSyncService,
    NbaNightlyService,
    PlayerStatsService,
  ],
  exports: [NbaSyncService, BalldontlieClient, PlayerStatsService],
})
export class NbaModule {}
