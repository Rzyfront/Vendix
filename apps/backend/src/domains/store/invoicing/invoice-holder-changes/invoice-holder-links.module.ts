import { Module } from '@nestjs/common';
import { InvoiceHolderLinkService } from './invoice-holder-link.service';
@Module({
  providers: [InvoiceHolderLinkService],
  exports: [InvoiceHolderLinkService],
})
export class InvoiceHolderLinksModule {}
