import { Controller, Get, Post, Patch, Param, Body, ParseIntPipe } from '@nestjs/common';
import { PayrollRulesService } from './payroll-rules.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { UpdatePayrollRulesDto } from './dto/update-payroll-rules.dto';

@Controller('store/payroll/rules')
export class PayrollRulesController {
  constructor(
    private readonly payroll_rules_service: PayrollRulesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  async getConfiguredYears() {
    const result = await this.payroll_rules_service.getConfiguredYears();
    return this.response_service.success(result);
  }

  @Get('available-updates')
  async getAvailableUpdates() {
    const updates = await this.payroll_rules_service.getAvailableUpdates();
    return this.response_service.success(updates);
  }

  @Post(':year/apply-defaults')
  async applySystemDefaults(@Param('year', ParseIntPipe) year: number) {
    const rules = await this.payroll_rules_service.applySystemDefaults(year);
    return this.response_service.success(rules);
  }

  @Get(':year')
  async getRulesForYear(@Param('year') year: string) {
    const result = await this.payroll_rules_service.getRulesForYear(+year);
    return this.response_service.success(result);
  }

  @Patch(':year')
  async updateRulesForYear(
    @Param('year') year: string,
    @Body() dto: UpdatePayrollRulesDto,
  ) {
    const result = await this.payroll_rules_service.updateRulesForYear(+year, dto);
    return this.response_service.success(result, 'Payroll rules updated successfully');
  }
}
