import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { PayrollReportsService } from './payroll/payroll-reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('store/reports')
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly payroll_reports_service: PayrollReportsService,
    private readonly response_service: ResponseService,
  ) {}

  // ==================== PAYROLL REPORTS ====================

  @Get('payroll/summary')
  @Permissions('store:payroll:read')
  async getPayrollSummary(@Query() query: ReportQueryDto) {
    const result = await this.payroll_reports_service.getPayrollSummary(
      query.date_from,
      query.date_to,
    );
    return this.response_service.success(result);
  }

  @Get('payroll/by-employee')
  @Permissions('store:payroll:read')
  async getPayrollByEmployee(@Query() query: ReportQueryDto) {
    const result = await this.payroll_reports_service.getPayrollByEmployee(
      query.date_from,
      query.date_to,
    );
    return this.response_service.success(result);
  }

  @Get('payroll/provisions')
  @Permissions('store:payroll:read')
  async getPayrollProvisions(@Query() query: ReportQueryDto) {
    const result = await this.payroll_reports_service.getPayrollProvisions(
      query.date_from,
      query.date_to,
    );
    return this.response_service.success(result);
  }
}
