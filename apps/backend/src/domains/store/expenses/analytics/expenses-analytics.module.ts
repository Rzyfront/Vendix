import { Module } from '@nestjs/common';
import { ExpensesAnalyticsController } from './expenses-analytics.controller';
import { ExpensesAnalyticsService } from './expenses-analytics.service';
import { ResponseModule } from '../../../../common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [ExpensesAnalyticsController],
  providers: [ExpensesAnalyticsService],
  exports: [ExpensesAnalyticsService],
})
export class ExpensesAnalyticsModule {}
