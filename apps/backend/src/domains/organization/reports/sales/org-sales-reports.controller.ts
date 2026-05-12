import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgSalesReportsService } from './org-sales-reports.service';
import { OrgReportQueryDto } from '../dto/org-report-query.dto';

/**
 * Reportes de ventas consolidados para ORG_ADMIN. Default consolidado por
 * organización; con `?store_id=X` se reduce el alcance a una tienda concreta
 * (breakdown). El DomainScopeGuard asegura que sólo `app_type=ORG_ADMIN`
 * pueda llegar a este controller.
 */
@Controller('organization/reports/sales')
@UseGuards(PermissionsGuard)
export class OrgSalesReportsController {
  constructor(
    private readonly salesReports: OrgSalesReportsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summary')
  @Permissions('reports:sales:read')
  async getSummary(@Query() query: OrgReportQueryDto) {
    const data = await this.salesReports.getSalesSummary({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Resumen de ventas obtenido');
  }

  @Get('by-store')
  @Permissions('reports:sales:read')
  async getByStore(@Query() query: OrgReportQueryDto) {
    const data = await this.salesReports.getSalesByStore({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Ventas por tienda obtenidas');
  }

  @Get('by-channel')
  @Permissions('reports:sales:read')
  async getByChannel(@Query() query: OrgReportQueryDto) {
    const data = await this.salesReports.getSalesByChannel({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Ventas por canal obtenidas');
  }

  @Get('top-products')
  @Permissions('reports:sales:read')
  async getTopProducts(@Query() query: OrgReportQueryDto) {
    const data = await this.salesReports.getTopProducts({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(
      data,
      'Productos más vendidos obtenidos',
    );
  }
}
