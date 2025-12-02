import { Module } from '@nestjs/common';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { DomainsModule } from './domains/domains.module';
import { StoresModule } from './stores/stores.module';
import { AddressesModule } from './addresses/addresses.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { SessionsModule } from './sessions/sessions.module';
import { LoginAttemptsModule } from './login-attempts/login-attempts.module';
import { PaymentPoliciesModule } from './payment-policies/payment-policies.module';

@Module({
  imports: [
    OrganizationsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    DomainsModule,
    StoresModule,
    AddressesModule,
    AuditModule,
    SettingsModule,
    SessionsModule,
    LoginAttemptsModule,
    PaymentPoliciesModule,
  ],
  providers: [OrganizationPrismaService],
  exports: [OrganizationPrismaService],
})
export class OrganizationDomainModule {}
