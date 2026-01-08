import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SuperadminDomainModule } from './superadmin/superadmin.module';
import { OrganizationDomainModule } from './organization/organization.module';
import { StoreDomainModule } from './store/store.module';
import { PublicDomainModule } from './public/public.module';
import { UploadModule } from './upload/upload.module';
import { EcommerceDomainModule } from './ecommerce/ecommerce.module';

@Module({
  imports: [
    AuthModule,
    SuperadminDomainModule,
    OrganizationDomainModule,
    StoreDomainModule,
    PublicDomainModule,
    UploadModule,
    EcommerceDomainModule,
  ],
})
export class DomainsModule { }
