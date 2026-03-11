import { Controller, Get, Query } from '@nestjs/common';
import { AccountingReportsService } from './accounting-reports.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('store/accounting/reports')
export class AccountingReportsController {
  constructor(
    private readonly accounting_reports_service: AccountingReportsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('trial-balance')
  async getTrialBalance(@Query() query_dto: ReportQueryDto) {
    const result = await this.accounting_reports_service.getTrialBalance(query_dto);
    return this.response_service.success(result);
  }

  @Get('balance-sheet')
  async getBalanceSheet(@Query() query_dto: ReportQueryDto) {
    const result = await this.accounting_reports_service.getBalanceSheet(query_dto);
    return this.response_service.success(result);
  }

  @Get('income-statement')
  async getIncomeStatement(@Query() query_dto: ReportQueryDto) {
    const result = await this.accounting_reports_service.getIncomeStatement(query_dto);
    return this.response_service.success(result);
  }

  @Get('general-ledger')
  async getGeneralLedger(@Query() query_dto: ReportQueryDto) {
    const result = await this.accounting_reports_service.getGeneralLedger(query_dto);
    return this.response_service.success(result);
  }
}
