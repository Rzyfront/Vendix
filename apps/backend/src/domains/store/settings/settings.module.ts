import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { FiscalStatusController } from './fiscal-status.controller';
import { EmailTemplatesController } from './email-templates.controller';
import { RutScannerController } from './rut-scanner.controller';
import { ScheduleValidationService } from './schedule-validation.service';
import { SettingsMigratorService } from './migrations/settings-migrator.service';
import { RutScannerService } from './rut-scanner.service';
import { ResponseService } from '@common/responses/response.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditModule } from '../../../common/audit/audit.module';
import { EmailModule } from '../../../email/email.module';
import { FiscalStatusService } from '@common/services/fiscal-status.service';

@Module({
  imports: [PrismaModule, AuditModule, EmailModule],
  controllers: [
    SettingsController,
    FiscalStatusController,
    EmailTemplatesController,
    RutScannerController,
  ],
  providers: [
    SettingsService,
    FiscalStatusService,
    ScheduleValidationService,
    SettingsMigratorService,
    RutScannerService,
    ResponseService,
  ],
  exports: [
    SettingsService,
    FiscalStatusService,
    ScheduleValidationService,
    SettingsMigratorService,
    RutScannerService,
  ],
})
export class SettingsModule {}
