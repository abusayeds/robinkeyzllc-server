import { Module } from '@nestjs/common';
import { TradeBlockService } from './trade.block.service';
import { TradeController } from './trade.controller';
import { TradeFinderService } from './trade.finder.service';
import { TradeService } from './trade.service';
import { NbaModule } from '../nba/nba.module';
import { NewsModule } from '../news/news.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // The Trade Finder board shows last season's averages, which the NBA
  // module works out from the game lines it syncs.
  imports: [NbaModule, NewsModule, NotificationModule],
  controllers: [TradeController],
  providers: [TradeService, TradeFinderService, TradeBlockService],
  exports: [TradeService, TradeFinderService, TradeBlockService],
})
export class TradeModule {}
