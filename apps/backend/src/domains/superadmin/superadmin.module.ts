import { Module } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { DashboardModule } from './dashboard/dashboard.module';
import { DomainsModule } from './domains/domains.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AuditModule } from './audit/audit.module';
import { StoresModule } from './stores/stores.module';
import { UsersModule } from './users/users.module';
import { TemplatesModule } from './templates/templates.module';
import { CurrenciesModule } from './currencies/currencies.module';

@Module({
  imports: [
    DashboardModule,
    DomainsModule,
    OrganizationsModule,
    PermissionsModule,
    RolesModule,
    StoresModule,
    UsersModule,
    AuditModule,
    TemplatesModule,
    CurrenciesModule,
  ],
  providers: [GlobalPrismaService],
  exports: [GlobalPrismaService],
})
export class SuperadminDomainModule { }
