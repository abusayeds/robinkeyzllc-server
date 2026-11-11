import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { ExtensionService } from './extension.service';
import { WaiveService } from './waive.service';

@Module({
  controllers: [RosterController],
  providers: [RosterService, WaiveService, ExtensionService],
  exports: [RosterService, WaiveService, ExtensionService],
})
export class RosterModule {}
