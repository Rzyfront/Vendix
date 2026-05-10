import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { OperatingScopeController } from './operating-scope.controller';
import { FiscalScopeController } from './fiscal-scope.controller';
import { FiscalStatusController } from './fiscal-status.controller';
import { OperatingScopeMigrationService } from '@common/services/operating-scope-migration.service';
import { FiscalScopeMigrationService } from '@common/services/fiscal-scope-migration.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { AuditModule } from '@common/audit/audit.module';
import { OrgInventoryModule } from '../inventory/inventory.module';

/**
 * Organization Settings module.
 *
 * Hosts:
 *  - Generic settings CRUD (`SettingsController` / `SettingsService`).
 *  - Phase 4 operating-scope wizard (`OperatingScopeController` +
 *    `OperatingScopeMigrationService`). The migration service depends on
 *    `GlobalPrismaService` and `OperatingScopeService`, both exported by
 *    `PrismaModule`, and on `OrgLocationsService` (exported by
 *    `OrgInventoryModule`) to provision/deactivate the central warehouse
 *    on STORE↔ORGANIZATION migrations.
 */
@Module({
  imports: [ResponseModule, AuditModule, PrismaModule, OrgInventoryModule],
  controllers: [
    SettingsController,
    OperatingScopeController,
    FiscalScopeController,
    FiscalStatusController,
  ],
  providers: [
    SettingsService,
    OperatingScopeMigrationService,
    FiscalScopeMigrationService,
    FiscalStatusService,
  ],
  exports: [
    SettingsService,
    OperatingScopeMigrationService,
    FiscalScopeMigrationService,
    FiscalStatusService,
  ],
})
export class SettingsModule {}
