import { Module } from '@nestjs/common';
import { GlobalPrismaService } from './services/global-prisma.service';
import { OrganizationPrismaService } from './services/organization-prisma.service';
import { StorePrismaService } from './services/store-prisma.service';
import { EcommercePrismaService } from './services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalStatusResolverService } from '@common/services/fiscal-status-resolver.service';
import { FiscalStatusMigrationService } from '@common/services/fiscal-status-migration.service';

@Module({
  providers: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
    StoreContextRunner,
    OperatingScopeService,
    FiscalScopeService,
    FiscalStatusResolverService,
    FiscalStatusMigrationService,
  ],
  exports: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
    StoreContextRunner,
    OperatingScopeService,
    FiscalScopeService,
    FiscalStatusResolverService,
    FiscalStatusMigrationService,
  ],
})
export class PrismaModule {}
