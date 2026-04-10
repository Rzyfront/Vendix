import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ReportsController } from './reports.controller';
import { PayrollReportsService } from './payroll/payroll-reports.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [ReportsController],
  providers: [PayrollReportsService],
})
export class ReportsModule {}
