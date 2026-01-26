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
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';

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
    PaymentMethodsModule,
  ],
  providers: [GlobalPrismaService],
  exports: [GlobalPrismaService],
})
export class SuperadminDomainModule {}
