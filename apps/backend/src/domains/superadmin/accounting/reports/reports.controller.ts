import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ReportsService } from './reports.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ReportParamsDto } from './dto/report-params.dto';

@Controller('super-admin/fiscal/accounting/reports')
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reports_service: ReportsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('trial-balance')
  @Permissions('superadmin:fiscal:reports:read')
  async getTrialBalance(@Query() query: ReportParamsDto) {
    const result = await this.reports_service.getTrialBalance(query);
    return this.response_service.success(result);
  }

  @Get('balance-sheet')
  @Permissions('superadmin:fiscal:reports:read')
  async getBalanceSheet(@Query() query: ReportParamsDto) {
    const result = await this.reports_service.getBalanceSheet(query);
    return this.response_service.success(result);
  }

  @Get('income-statement')
  @Permissions('superadmin:fiscal:reports:read')
  async getIncomeStatement(@Query() query: ReportParamsDto) {
    const result = await this.reports_service.getIncomeStatement(query);
    return this.response_service.success(result);
  }

  @Get('general-ledger')
  @Permissions('superadmin:fiscal:reports:read')
  async getGeneralLedger(@Query() query: ReportParamsDto) {
    const result = await this.reports_service.getGeneralLedger(query);
    return this.response_service.success(result);
  }
}
