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
import { CashRegistersModule } from '../cash-registers/cash-registers.module';

@Module({
  // QUI-560 — `SettingsService` consulta las sesiones de caja abiertas para
  // bloquear el apagado del módulo. `CashRegistersModule` solo importa
  // `PrismaModule` y `ResponseModule`, así que no hay ciclo.
  imports: [PrismaModule, AuditModule, EmailModule, CashRegistersModule],
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
