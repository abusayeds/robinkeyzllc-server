import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  // The activity card is the Transactions feed narrowed to one team, so the
  // two screens cannot describe the same trade differently.
  imports: [TransactionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
