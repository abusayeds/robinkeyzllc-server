import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { LeagueInviteController } from './league-invite.controller';

@Module({
  imports: [NotificationModule],
  controllers: [LeagueInviteController, InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
