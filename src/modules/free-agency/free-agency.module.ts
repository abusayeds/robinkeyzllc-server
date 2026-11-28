import { Module } from '@nestjs/common';
import { FreeAgencyController } from './free-agency.controller';
import { FreeAgencyService } from './free-agency.service';
import { NewsModule } from '../news/news.module';
import { NbaModule } from '../nba/nba.module';

@Module({
  imports: [NewsModule, NbaModule],
  controllers: [FreeAgencyController],
  providers: [FreeAgencyService],
  exports: [FreeAgencyService],
})
export class FreeAgencyModule {}
