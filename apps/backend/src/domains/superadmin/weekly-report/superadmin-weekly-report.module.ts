import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { WeeklyReportModule } from '../../store/weekly-report/weekly-report.module';
import { SuperadminWeeklyReportController } from './superadmin-weekly-report.controller';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    NotificationsModule,
    WeeklyReportModule,
  ],
  controllers: [SuperadminWeeklyReportController],
})
export class SuperadminWeeklyReportModule {}
