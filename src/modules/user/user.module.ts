import { Module } from '@nestjs/common';
import { usersController } from './user.controller';
import { usersService } from './user.service';

@Module({
  controllers: [usersController],
  providers: [usersService],
  exports: [usersService],
})
export class usersModule {}
