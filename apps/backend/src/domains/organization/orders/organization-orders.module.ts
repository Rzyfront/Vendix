import { Module } from '@nestjs/common';
import { OrganizationOrdersController } from './organization-orders.controller';
import { OrganizationOrdersService } from './organization-orders.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

/**
 * `/api/organization/orders/*` — org-native orders module (read-only).
 *
 * Phase 2 — Orders org-native (read-only consolidado):
 *   - GET / (consolidado, filtros ?store_id, ?status, ?customer_id, paginación)
 *   - GET /:id (detalle, valida pertenencia a la org)
 *   - GET /stats (totales agregados org-wide o por tienda con ?store_id)
 *   - GET /recent (últimas N para dashboard)
 *   - GET /:id/invoice (PDF)
 *
 * Reglas operating_scope:
 *   - ORGANIZATION → consolidado sobre todas las stores de la org;
 *     ?store_id=X opcional para breakdown.
 *   - STORE → ?store_id obligatorio.
 *
 * La creación/mutación de orders permanece en `/store/orders/*`.
 *
 * Dependencias (`OrganizationPrismaService`, `OperatingScopeService`,
 * `RequestContextService`) se obtienen vía PrismaModule (export central).
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [OrganizationOrdersController],
  providers: [OrganizationOrdersService],
  exports: [OrganizationOrdersService],
})
export class OrganizationOrdersModule {}
