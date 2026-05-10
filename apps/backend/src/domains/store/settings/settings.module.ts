import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { EmailTemplatesController } from './email-templates.controller';
import { ScheduleValidationService } from './schedule-validation.service';
import { SettingsMigratorService } from './migrations/settings-migrator.service';
import { ResponseService } from '@common/responses/response.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditModule } from '../../../common/audit/audit.module';
import { EmailModule } from '../../../email/email.module';

@Module({
  imports: [PrismaModule, AuditModule, EmailModule],
  controllers: [SettingsController, EmailTemplatesController],
  providers: [
    SettingsService,
    ScheduleValidationService,
    SettingsMigratorService,
    ResponseService,
  ],
  exports: [
    SettingsService,
    ScheduleValidationService,
    SettingsMigratorService,
  ],
})
export class SettingsModule {}
