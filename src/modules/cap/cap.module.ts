import { Global, Module } from '@nestjs/common';
import { CapController, LeagueCapController } from './cap.controller';
import { CapService } from './cap.service';

// Global: tiers, thresholds and matching bands are read by trades, salaries,
// free agency, rosters and the overview. Importing it into six modules would
// be the same thing written six times.
@Global()
@Module({
  controllers: [CapController, LeagueCapController],
  providers: [CapService],
  exports: [CapService],
})
export class CapModule {}
