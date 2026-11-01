import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { usersModule } from './modules/user/user.module';
import { managementModel } from './modules/management/management.model';
import { authModule } from './modules/auth/auth.module';
import { SeedModule } from './seed/seed.module';
import { OtpModule } from './common/otp/otp.module';
import { UploadModule } from './modules/upload/upload.module';
import { LeagueModule } from './modules/league/league.module';
import { TeamModule } from './modules/team/team.module';
import { InviteModule } from './modules/invite/invite.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PlayerModule } from './modules/player/player.module';
import { ImportModule } from './modules/import/import.module';
import { RosterModule } from './modules/roster/roster.module';
import { SalaryModule } from './modules/salary/salary.module';
import { FreeAgencyModule } from './modules/free-agency/free-agency.module';
import { OverviewModule } from './modules/overview/overview.module';
import { NbaModule } from './modules/nba/nba.module';
import { TradeModule } from './modules/trade/trade.module';
import { CapModule } from './modules/cap/cap.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    CapModule,
    OtpModule,
    usersModule,
    managementModel,
    authModule,
    SeedModule,
    UploadModule,
    LeagueModule,
    TeamModule,
    InviteModule,
    NotificationModule,
    PlayerModule,
    ImportModule,
    RosterModule,
    SalaryModule,
    FreeAgencyModule,
    OverviewModule,
    NbaModule,
    TradeModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).exclude().forRoutes('*');
  }
}
