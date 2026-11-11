import { Module } from '@nestjs/common';
import { DraftController } from './draft.controller';
import { DraftLiveService } from './draft.live.service';
import { DraftPicksService } from './draft.picks.service';
import { DraftService } from './draft.service';
import { NbaModule } from '../nba/nba.module';

@Module({
  // The pool shows last season's averages, which the NBA module works out
  // from the game lines it syncs.
  imports: [NbaModule],
  controllers: [DraftController],
  providers: [DraftService, DraftPicksService, DraftLiveService],
  exports: [DraftService, DraftPicksService, DraftLiveService],
})
export class DraftModule {}
