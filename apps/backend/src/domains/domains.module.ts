import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SuperadminDomainModule } from './superadmin/superadmin.module';
import { OrganizationDomainModule } from './organization/organization.module';
import { StoreDomainModule } from './store/store.module';
import { PublicDomainModule } from './public/public.module';
import { EcommerceDomainModule } from './ecommerce/ecommerce.module';
import { SupportModule } from './support/support.module';
import { HelpCenterModule } from './help-center/help-center.module';
import { FiscalOperationsModule } from './fiscal-operations/fiscal-operations.module';

@Module({
  imports: [
    AuthModule,
    SuperadminDomainModule,
    OrganizationDomainModule,
    StoreDomainModule,
    PublicDomainModule,
    EcommerceDomainModule,
    SupportModule,
    HelpCenterModule,
    FiscalOperationsModule,
  ],
})
export class DomainsModule {}
