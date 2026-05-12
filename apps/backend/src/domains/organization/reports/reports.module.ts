import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { InventoryModule } from '../../store/inventory/inventory.module';

import { OrgSalesReportsController } from './sales/org-sales-reports.controller';
import { OrgSalesReportsService } from './sales/org-sales-reports.service';

import { OrgInventoryReportsController } from './inventory/org-inventory-reports.controller';
import { OrgInventoryReportsService } from './inventory/org-inventory-reports.service';

import { OrgFinancialReportsController } from './financial/org-financial-reports.controller';
import { OrgFinancialReportsService } from './financial/org-financial-reports.service';

import { OrgPayrollReportsController } from './payroll/org-payroll-reports.controller';
import { OrgPayrollReportsService } from './payroll/org-payroll-reports.service';

/**
 * `/api/organization/reports/*` — org-native reports module (Fase 2).
 *
 * Construido desde cero usando `OrganizationPrismaService` y respetando
 * `operating_scope`:
 *   - ORGANIZATION (default) → consolidado sobre todas las tiendas de la org.
 *   - `?store_id=X` opcional → breakdown filtrado a esa sola tienda
 *     (pertenencia validada contra la org).
 *   - STORE scope dentro de una org multi-tienda → exige `store_id` explícito
 *     (mismo contrato que `OrganizationPrismaService.getScopedWhere`).
 *
 * Submódulos:
 *   - sales/      — ventas consolidadas (orders, order_items)
 *   - inventory/  — stock consolidado (stock_levels via inventory_locations)
 *   - financial/  — Trial Balance, Balance Sheet, P&L, General Ledger
 *   - payroll/    — nómina (org-aggregated nativa, breakdown opcional)
 *
 * No reusa los servicios de `/store/*` para no relajar `StorePrismaService`
 * (regla cero del plan operating-scope). Las queries van directo a Prisma con
 * filtros explícitos por `organization_id` + `store_id` opcional.
 */
@Module({
  imports: [PrismaModule, ResponseModule, InventoryModule],
  controllers: [
    OrgSalesReportsController,
    OrgInventoryReportsController,
    OrgFinancialReportsController,
    OrgPayrollReportsController,
  ],
  providers: [
    OrgSalesReportsService,
    OrgInventoryReportsService,
    OrgFinancialReportsService,
    OrgPayrollReportsService,
  ],
})
export class OrgReportsModule {}
