import { Module } from '@nestjs/common';
import { ScheduleController, StandingsController } from './scoring.controller';
import { MatchupService } from './matchup.service';
import { ScheduleService } from './schedule.service';
import { SettleService } from './settle.service';
import { StandingsService } from './standings.service';

@Module({
  controllers: [StandingsController, ScheduleController],
  providers: [ScheduleService, SettleService, StandingsService, MatchupService],
  exports: [ScheduleService, SettleService, StandingsService, MatchupService],
})
export class ScoringModule {}
