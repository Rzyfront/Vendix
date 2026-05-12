import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Query } from '@nestjs/common';
import { AccountingReportsService } from './accounting-reports.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('store/accounting/reports')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class AccountingReportsController {
  constructor(
    private readonly accounting_reports_service: AccountingReportsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('trial-balance')
  @Permissions('store:accounting:reports:read')
  async getTrialBalance(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getTrialBalance(query_dto);
    return this.response_service.success(result);
  }

  @Get('balance-sheet')
  @Permissions('store:accounting:reports:read')
  async getBalanceSheet(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getBalanceSheet(query_dto);
    return this.response_service.success(result);
  }

  @Get('income-statement')
  @Permissions('store:accounting:reports:read')
  async getIncomeStatement(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getIncomeStatement(query_dto);
    return this.response_service.success(result);
  }

  @Get('general-ledger')
  @Permissions('store:accounting:reports:read')
  async getGeneralLedger(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getGeneralLedger(query_dto);
    return this.response_service.success(result);
  }
}
