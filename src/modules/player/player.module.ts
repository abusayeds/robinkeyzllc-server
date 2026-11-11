import { Module } from '@nestjs/common';
import { NbaModule } from '../nba/nba.module';
import { PlayerController } from './player.controller';
import { PlayerProfileController } from './player-profile.controller';
import { PlayerProfileService } from './player-profile.service';
import { PlayerService } from './player.service';

@Module({
  // For `PlayerStatsService`: the career table and the game log are worked out
  // from the stored game lines, which is the NBA module's own arithmetic.
  imports: [NbaModule],
  controllers: [PlayerController, PlayerProfileController],
  providers: [PlayerService, PlayerProfileService],
  exports: [PlayerService],
})
export class PlayerModule {}
