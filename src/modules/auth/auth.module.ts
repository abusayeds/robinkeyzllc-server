import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { usersModule } from '../user/user.module';
import { authController } from './auth.controller';
import { authService } from './auth.service';

@Module({
  imports: [
    usersModule,
    JwtModule.registerAsync({
      // Global so AuthGuard can resolve JwtService from any module.
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [authController],
  providers: [authService],
  exports: [authService],
})
export class authModule {}
