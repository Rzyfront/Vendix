import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

import { PurchaseOrdersModule } from '../../store/orders/purchase-orders/purchase-orders.module';

import { OrgPurchaseOrdersController } from './org-purchase-orders.controller';
import { OrgPurchaseOrdersService } from './org-purchase-orders.service';

/**
 * `/api/organization/purchase-orders/*` — org-native purchase orders.
 *
 * Lecturas via `OrganizationPrismaService` (consolidado + breakdown opcional
 * por tienda). Las mutaciones (create/approve/cancel/receive) reusan el
 * `PurchaseOrdersService` store-side delegando con
 * `runWithStoreContext(store_id)` para no duplicar audit, eventos, costing,
 * ni stock-level-manager.
 *
 * `PurchaseOrdersModule` se importa explícitamente porque exporta
 * `PurchaseOrdersService` (no es @Global).
 */
@Module({
  imports: [PrismaModule, ResponseModule, PurchaseOrdersModule],
  controllers: [OrgPurchaseOrdersController],
  providers: [OrgPurchaseOrdersService],
  exports: [OrgPurchaseOrdersService],
})
export class OrgPurchaseOrdersModule {}
