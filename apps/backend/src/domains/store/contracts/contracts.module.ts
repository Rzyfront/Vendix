import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { ConstructionIndustryGuard } from '../../../common/guards/construction-industry.guard';
import { QuotationProfilesModule } from '../backend-quotations-profiles/quotation-profiles.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

/**
 * C.1 — Modulo de contratos de obra.
 *
 * Importa `QuotationProfilesModule` (no duplica el proveedor) para resolver
 * `quotations.profile_id` via `resolveForQuotation` (regla de ownership de
 * servicios compartidos). `ConstructionIndustryGuard` se provee aca: su
 * dependencia (`GlobalPrismaService`) la exporta `PrismaModule`.
 *
 * D.2 (FB-08) — importa `InvoicingModule` (no duplica el provider) para que
 * `POST :id/invoice` delegue en `InvoicingService.createInvoiceFromContract`.
 * Sin ciclo: `InvoicingModule` no importa este modulo.
 */
@Module({
  imports: [PrismaModule, ResponseModule, QuotationProfilesModule, InvoicingModule],
  controllers: [ContractsController],
  providers: [ContractsService, ConstructionIndustryGuard],
  exports: [ContractsService],
})
export class ContractsModule {}
