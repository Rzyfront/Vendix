import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
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
