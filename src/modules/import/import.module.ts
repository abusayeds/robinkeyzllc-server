import { Module } from '@nestjs/common';
import { PlayerModule } from '../player/player.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [PlayerModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
