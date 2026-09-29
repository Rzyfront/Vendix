import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createSettingsAdminTools } from '../../../ai-engine/tools/domains/settings-admin.tools';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { StoreRolesModule } from '../roles/store-roles.module';
import { StoreRolesService } from '../roles/store-roles.service';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { FiscalStatusController } from './fiscal-status.controller';
import { EmailTemplatesController } from './email-templates.controller';
import { RutScannerController } from './rut-scanner.controller';
import { ScheduleValidationService } from './schedule-validation.service';
import { SettingsMigratorService } from './migrations/settings-migrator.service';
import { PosSearchPathService } from './pos-smart-search/pos-search-path.service';
import { RutScannerService } from './rut-scanner.service';
import { ResponseService } from '@common/responses/response.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditModule } from '../../../common/audit/audit.module';
import { EmailModule } from '../../../email/email.module';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';

@Module({
  // QUI-560 — `SettingsService` consulta las sesiones de caja abiertas para
  // bloquear el apagado del módulo. forwardRef en ambas direcciones porque
  // QUI-784 agregó la dependencia inversa (sessions→settings vía token) y
  // CashRegistersModule ahora importa SettingsModule para proveer el token.
  imports: [
    PrismaModule,
    AuditModule,
    EmailModule,
    StoreRolesModule,
    forwardRef(() => CashRegistersModule),
  ],
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
    PosSearchPathService,
    RutScannerService,
    ResponseService,
  ],
  exports: [
    SettingsService,
    FiscalStatusService,
    ScheduleValidationService,
    SettingsMigratorService,
    PosSearchPathService,
    RutScannerService,
  ],
})
export class SettingsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly settingsService: SettingsService,
    private readonly fiscalStatusService: FiscalStatusService,
    private readonly rolesService: StoreRolesService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  /**
   * Registra la familia settings-admin de Vexi (F-82, F-83, F-85, F-87,
   * F-88, F-92) desde el dominio que posee los datos. Vive aquí y no en
   * `AIEngineModule` porque ese módulo es `@Global()`: importar un dominio
   * por familia genera ciclos de dependencia. `StoreRolesModule` no importa
   * a `SettingsModule`, así que esta arista no cierra un ciclo.
   * `FiscalScopeService`/`OperatingScopeService` llegan vía `PrismaModule`
   * (ya importado).
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createSettingsAdminTools({
        settingsService: this.settingsService,
        fiscalStatusService: this.fiscalStatusService,
        rolesService: this.rolesService,
        fiscalScopeService: this.fiscalScope,
        operatingScopeService: this.operatingScope,
      }),
    );
  }
}
