import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { ScheduleValidationService } from './schedule-validation.service';
import { ResponseService } from '@common/responses/response.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditModule } from '../../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService, ScheduleValidationService, ResponseService],
  exports: [SettingsService, ScheduleValidationService],
})
export class SettingsModule {}
