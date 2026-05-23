import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { MockInvoiceProvider } from './mock-invoice.provider';
import { InvoiceProviderResolver } from './invoice-provider-resolver.service';
import { DianDirectModule } from './dian-direct/dian-direct.module';
import { FiscalProductionReadinessService } from './fiscal-production-readiness.service';

@Module({
  imports: [PrismaModule, DianDirectModule],
  providers: [
    MockInvoiceProvider,
    InvoiceProviderResolver,
    FiscalProductionReadinessService,
  ],
  exports: [
    InvoiceProviderResolver,
    MockInvoiceProvider,
    FiscalProductionReadinessService,
  ],
})
export class InvoiceProviderModule {}
