import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SuperadminDomainModule } from './superadmin/superadmin.module';
import { OrganizationDomainModule } from './organization/organization.module';
import { StoreDomainModule } from './store/store.module';
import { PublicDomainModule } from './public/public.module';

@Module({
  imports: [
    AuthModule,
    SuperadminDomainModule,
    OrganizationDomainModule,
    StoreDomainModule,
    PublicDomainModule,
  ],
})
export class DomainsModule {}
