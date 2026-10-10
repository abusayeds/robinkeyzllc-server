import { Module } from '@nestjs/common';
import { managementService } from './management.service';
import { managementController } from './management.controller';

@Module({
  controllers: [managementController],
  providers: [managementService],
  exports: [managementService],
})
export class managementModel {}
