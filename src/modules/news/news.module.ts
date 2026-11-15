import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsPublisher } from './news.publisher';
import { NewsService } from './news.service';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  // Four of the seven news categories are moves, which the transactions feed
  // already describes. Reading it keeps one wording per event.
  imports: [TransactionsModule],
  controllers: [NewsController],
  providers: [NewsService, NewsPublisher],
  exports: [NewsService, NewsPublisher],
})
export class NewsModule {}
