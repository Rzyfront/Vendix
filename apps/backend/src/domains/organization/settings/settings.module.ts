import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { OperatingScopeController } from './operating-scope.controller';
import { OperatingScopeMigrationService } from '@common/services/operating-scope-migration.service';
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
  controllers: [SettingsController, OperatingScopeController],
  providers: [SettingsService, OperatingScopeMigrationService],
  exports: [SettingsService, OperatingScopeMigrationService],
})
export class SettingsModule {}
