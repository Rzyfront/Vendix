import { Module } from '@nestjs/common';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';

import { DomainsModule } from './domains/domains.module';
import { StoresModule } from './stores/stores.module';
import { AddressesModule } from './addresses/addresses.module';

import { SettingsModule } from './settings/settings.module';
import { SessionsModule } from './sessions/sessions.module';
import { LoginAttemptsModule } from './login-attempts/login-attempts.module';
import { PaymentPoliciesModule } from './payment-policies/payment-policies.module';
import { AuditModule } from './audit/audit.module';
import { ResellerModule } from './reseller/reseller.module';
import { OrganizationOrdersModule } from './orders/organization-orders.module';
import { OrgSubscriptionsModule } from './subscriptions/subscriptions.module';
import { OrgAccountingModule } from './accounting/accounting.module';
import { OrgInventoryModule } from './inventory/inventory.module';
import { OrgReportsModule } from './reports/reports.module';
import { OrgPurchaseOrdersModule } from './purchase-orders/purchase-orders.module';

@Module({
  imports: [
    OrganizationsModule,
    UsersModule,
    RolesModule,

    DomainsModule,
    StoresModule,
    AddressesModule,
    SettingsModule,
    SessionsModule,
    LoginAttemptsModule,
    PaymentPoliciesModule,
    AuditModule,
    ResellerModule,
    OrganizationOrdersModule,
    OrgSubscriptionsModule,
    OrgAccountingModule,
    OrgInventoryModule,
    OrgReportsModule,
    OrgPurchaseOrdersModule,
  ],
  providers: [OrganizationPrismaService],
  exports: [OrganizationPrismaService],
})
export class OrganizationDomainModule {}
