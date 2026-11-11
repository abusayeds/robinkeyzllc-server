import { Module } from '@nestjs/common';
import { TradeController } from './trade.controller';
import { TradeFinderService } from './trade.finder.service';
import { TradeService } from './trade.service';
import { NbaModule } from '../nba/nba.module';

@Module({
  // The Trade Finder board shows last season's averages, which the NBA
  // module works out from the game lines it syncs.
  imports: [NbaModule],
  controllers: [TradeController],
  providers: [TradeService, TradeFinderService],
  exports: [TradeService, TradeFinderService],
})
export class TradeModule {}
