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
  ],
  providers: [OrganizationPrismaService],
  exports: [OrganizationPrismaService],
})
export class OrganizationDomainModule { }
