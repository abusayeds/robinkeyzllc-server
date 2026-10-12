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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    OtpModule,
    usersModule,
    managementModel,
    authModule,
    SeedModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).exclude().forRoutes('*');
  }
}
