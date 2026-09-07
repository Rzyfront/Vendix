import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

import { QuotationProfilesController } from './quotation-profiles.controller';
import { QuotationProfilesService } from './quotation-profiles.service';

/**
 * B.1 — Módulo de perfiles de cotización.
 *
 * El controller vive ACÁ (no en un módulo padre): el prefijo
 * `store/quotation-profiles` no colisiona con ningún `:id` de otro
 * controller —`QuotationsController` monta en `store/quotations`—, así que
 * no aplica la restricción de `ProfilesModule` (facturación), cuyo
 * controller tuvo que declararse en `InvoicingModule` porque
 * `InvoicingController` monta en el mismo prefijo con `@Get(':id')`.
 *
 * Se exporta el servicio para que C.1 (`contracts`) resuelva
 * `quotations.profile_id` vía `resolveForQuotation` (ERR-04) importando este
 * módulo, sin duplicar el proveedor (regla de ownership de servicios
 * compartidos).
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [QuotationProfilesController],
  providers: [QuotationProfilesService],
  exports: [QuotationProfilesService],
})
export class QuotationProfilesModule {}
