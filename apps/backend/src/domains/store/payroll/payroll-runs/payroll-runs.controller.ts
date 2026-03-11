import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollFlowService } from './payroll-flow.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { UpdatePayrollRunDto } from './dto/update-payroll-run.dto';
import { QueryPayrollRunDto } from './dto/query-payroll-run.dto';

@Controller('store/payroll/runs')
export class PayrollRunsController {
  constructor(
    private readonly payroll_runs_service: PayrollRunsService,
    private readonly payroll_flow_service: PayrollFlowService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  async findAll(@Query() query_dto: QueryPayrollRunDto) {
    const result = await this.payroll_runs_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  async getStats() {
    const result = await this.payroll_runs_service.getStats();
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.payroll_runs_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreatePayrollRunDto) {
    const result = await this.payroll_runs_service.create(create_dto);
    return this.response_service.success(result, 'Payroll run created successfully');
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdatePayrollRunDto,
  ) {
    const result = await this.payroll_runs_service.update(+id, update_dto);
    return this.response_service.success(result, 'Payroll run updated successfully');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.payroll_runs_service.remove(+id);
    return this.response_service.success(null, 'Payroll run deleted successfully');
  }

  @Post(':id/calculate')
  @HttpCode(HttpStatus.OK)
  async calculate(@Param('id') id: string) {
    const result = await this.payroll_flow_service.calculate(+id);
    return this.response_service.success(result, 'Payroll calculated successfully');
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    const result = await this.payroll_flow_service.approve(+id);
    return this.response_service.success(result, 'Payroll approved successfully');
  }

  @Patch(':id/send')
  async send(@Param('id') id: string) {
    const result = await this.payroll_flow_service.send(+id);
    return this.response_service.success(result, 'Payroll sent to provider successfully');
  }

  @Patch(':id/pay')
  async pay(@Param('id') id: string) {
    const result = await this.payroll_flow_service.pay(+id);
    return this.response_service.success(result, 'Payroll marked as paid successfully');
  }

  @Patch(':id/cancel')
  async cancel(@Param('id') id: string) {
    const result = await this.payroll_flow_service.cancel(+id);
    return this.response_service.success(result, 'Payroll cancelled successfully');
  }
}
