import { Module } from '@nestjs/common';
import { FreeAgencyController } from './free-agency.controller';
import { FreeAgencyService } from './free-agency.service';

@Module({
  controllers: [FreeAgencyController],
  providers: [FreeAgencyService],
  exports: [FreeAgencyService],
})
export class FreeAgencyModule {}
