import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgPayrollReportsService } from './org-payroll-reports.service';
import { OrgReportQueryDto } from '../dto/org-report-query.dto';

/**
 * Reportes de nómina consolidados para ORG_ADMIN. La nómina ya es
 * naturalmente org-aggregated; con `?store_id=X` se filtra a corridas de una
 * tienda concreta (breakdown).
 */
@Controller('organization/reports/payroll')
@UseGuards(PermissionsGuard)
export class OrgPayrollReportsController {
  constructor(
    private readonly payrollReports: OrgPayrollReportsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summary')
  @Permissions('organization:payroll:reports:read')
  async getSummary(@Query() query: OrgReportQueryDto) {
    const data = await this.payrollReports.getPayrollSummary({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Resumen de nómina obtenido');
  }

  @Get('by-employee')
  @Permissions('organization:payroll:reports:read')
  async getByEmployee(@Query() query: OrgReportQueryDto) {
    const data = await this.payrollReports.getPayrollByEmployee({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(data, 'Nómina por empleado obtenida');
  }

  @Get('provisions')
  @Permissions('organization:payroll:reports:read')
  async getProvisions(@Query() query: OrgReportQueryDto) {
    const data = await this.payrollReports.getPayrollProvisions({
      date_from: query.date_from,
      date_to: query.date_to,
      store_id: query.store_id,
    });
    return this.responseService.success(
      data,
      'Provisiones laborales obtenidas',
    );
  }
}
