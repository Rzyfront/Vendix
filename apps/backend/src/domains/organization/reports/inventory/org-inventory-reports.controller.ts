import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgInventoryReportsService } from './org-inventory-reports.service';
import { OrgReportQueryDto } from '../dto/org-report-query.dto';

/**
 * Reportes de inventario consolidados para ORG_ADMIN. Consolida `stock_levels`
 * de todas las tiendas de la organización; con `?store_id=X` se restringe a
 * una tienda concreta (breakdown).
 */
@Controller('organization/reports/inventory')
@UseGuards(PermissionsGuard)
export class OrgInventoryReportsController {
  constructor(
    private readonly inventoryReports: OrgInventoryReportsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summary')
  @Permissions('reports:inventory:read')
  async getSummary(@Query() query: OrgReportQueryDto) {
    const data = await this.inventoryReports.getStockSummary({
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Resumen de inventario obtenido');
  }

  @Get('by-store')
  @Permissions('reports:inventory:read')
  async getByStore(@Query() query: OrgReportQueryDto) {
    const data = await this.inventoryReports.getStockByStore({
      store_id: query.store_id,
    });
    return this.responseService.success(
      data,
      'Inventario por tienda obtenido',
    );
  }

  @Get('low-stock')
  @Permissions('reports:inventory:read')
  async getLowStock(@Query() query: OrgReportQueryDto) {
    const data = await this.inventoryReports.getLowStock({
      store_id: query.store_id,
    });
    return this.responseService.success(
      data,
      'Productos en bajo stock obtenidos',
    );
  }

  @Get('valuation')
  @Permissions('reports:inventory:read')
  async getValuation(@Query() query: OrgReportQueryDto) {
    const data = await this.inventoryReports.getValuationSnapshot({
      store_id: query.store_id,
    });
    return this.responseService.success(
      data,
      'Valuación informativa de inventario obtenida',
    );
  }
}
