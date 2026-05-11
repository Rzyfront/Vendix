import { Module } from '@nestjs/common';
import { OrgDianConfigModule } from './dian-config/dian-config.module';

@Module({
  imports: [OrgDianConfigModule],
  exports: [OrgDianConfigModule],
})
export class OrgInvoicingModule {}
