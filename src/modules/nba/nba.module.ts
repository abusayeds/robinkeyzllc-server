import { Module } from '@nestjs/common';
import { BalldontlieClient } from './balldontlie.client';
import { NbaController } from './nba.controller';
import { NbaSyncService } from './nba-sync.service';

@Module({
  controllers: [NbaController],
  providers: [BalldontlieClient, NbaSyncService],
  exports: [NbaSyncService, BalldontlieClient],
})
export class NbaModule {}
