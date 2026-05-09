import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgFinancialReportsService } from './org-financial-reports.service';
import { OrgFinancialReportQueryDto } from '../dto/org-financial-report-query.dto';

/**
 * Reportes financieros consolidados para ORG_ADMIN: Trial Balance, Balance
 * Sheet, Income Statement, General Ledger. Naturalmente org-wide cuando
 * `operating_scope=ORGANIZATION`; con `?store_id=X` se hace breakdown por
 * tienda.
 */
@Controller('organization/reports/financial')
@UseGuards(PermissionsGuard)
export class OrgFinancialReportsController {
  constructor(
    private readonly financialReports: OrgFinancialReportsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('trial-balance')
  @Permissions('reports:financial:read')
  async getTrialBalance(@Query() query: OrgFinancialReportQueryDto) {
    const data = await this.financialReports.getTrialBalance(query);
    return this.responseService.success(data, 'Balance de prueba obtenido');
  }

  @Get('balance-sheet')
  @Permissions('reports:financial:read')
  async getBalanceSheet(@Query() query: OrgFinancialReportQueryDto) {
    const data = await this.financialReports.getBalanceSheet(query);
    return this.responseService.success(data, 'Balance general obtenido');
  }

  @Get('income-statement')
  @Permissions('reports:financial:read')
  async getIncomeStatement(@Query() query: OrgFinancialReportQueryDto) {
    const data = await this.financialReports.getIncomeStatement(query);
    return this.responseService.success(
      data,
      'Estado de resultados obtenido',
    );
  }

  @Get('general-ledger')
  @Permissions('reports:financial:read')
  async getGeneralLedger(@Query() query: OrgFinancialReportQueryDto) {
    const data = await this.financialReports.getGeneralLedger(query);
    return this.responseService.success(data, 'Libro mayor obtenido');
  }
}
