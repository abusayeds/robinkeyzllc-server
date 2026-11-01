import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { LeagueController } from './league.controller';
import { LeagueService } from './league.service';

@Module({
  imports: [NotificationModule],
  controllers: [LeagueController],
  providers: [LeagueService],
  exports: [LeagueService],
})
export class LeagueModule {}
