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
import { PayrollBankExportService } from '../bank-export/payroll-bank-export.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { UpdatePayrollRunDto } from './dto/update-payroll-run.dto';
import { QueryPayrollRunDto } from './dto/query-payroll-run.dto';
import { ExportAchDto } from '../bank-export/dto/export-ach.dto';

@Controller('store/payroll/runs')
export class PayrollRunsController {
  constructor(
    private readonly payroll_runs_service: PayrollRunsService,
    private readonly payroll_flow_service: PayrollFlowService,
    private readonly bank_export_service: PayrollBankExportService,
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

  @Get('bank-export/banks')
  async getAvailableBanks() {
    const result = this.bank_export_service.getAvailableBanks();
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
    return this.response_service.success(
      result,
      'Payroll run created successfully',
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdatePayrollRunDto,
  ) {
    const result = await this.payroll_runs_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Payroll run updated successfully',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.payroll_runs_service.remove(+id);
    return this.response_service.success(
      null,
      'Payroll run deleted successfully',
    );
  }

  @Post(':id/calculate')
  @HttpCode(HttpStatus.OK)
  async calculate(@Param('id') id: string) {
    const result = await this.payroll_flow_service.calculate(+id);
    return this.response_service.success(
      result,
      'Payroll calculated successfully',
    );
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    const result = await this.payroll_flow_service.approve(+id);
    return this.response_service.success(
      result,
      'Payroll approved successfully',
    );
  }

  @Patch(':id/send')
  async send(@Param('id') id: string) {
    const result = await this.payroll_flow_service.send(+id);
    return this.response_service.success(
      result,
      'Payroll sent to provider successfully',
    );
  }

  @Patch(':id/pay')
  async pay(@Param('id') id: string) {
    const result = await this.payroll_flow_service.pay(+id);
    return this.response_service.success(
      result,
      'Payroll marked as paid successfully',
    );
  }

  @Patch(':id/cancel')
  async cancel(@Param('id') id: string) {
    const result = await this.payroll_flow_service.cancel(+id);
    return this.response_service.success(
      result,
      'Payroll cancelled successfully',
    );
  }

  @Post(':id/send-dian')
  @HttpCode(HttpStatus.OK)
  async sendToDian(@Param('id') id: string) {
    const result = await this.payroll_flow_service.sendToDian(+id);
    return this.response_service.success(result, 'Payroll sent to DIAN');
  }

  @Get(':id/dian-status')
  async getDianStatus(@Param('id') id: string) {
    const result = await this.payroll_flow_service.getDianStatus(+id);
    return this.response_service.success(result);
  }

  @Get(':id/validate-bank-data')
  async validateBankData(@Param('id') id: string) {
    const result = await this.bank_export_service.validateEmployeeBankData(+id);
    return this.response_service.success(result);
  }

  @Post(':id/items/:itemId/send-adjustment')
  @HttpCode(HttpStatus.OK)
  async sendAdjustment(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body()
    body: {
      predecessor_cune: string;
      predecessor_document_number: string;
      predecessor_generation_date: string;
      adjustment_type?: '1' | '2';
    },
  ) {
    const result = await this.payroll_flow_service.sendAdjustment(
      +id,
      +itemId,
      {
        cune: body.predecessor_cune,
        document_number: body.predecessor_document_number,
        generation_date: body.predecessor_generation_date,
        adjustment_type: body.adjustment_type || '1',
      },
    );
    return this.response_service.success(
      result,
      'Adjustment note sent to DIAN',
    );
  }

  @Post(':id/export-ach')
  @HttpCode(HttpStatus.OK)
  async exportAch(@Param('id') id: string, @Body() dto: ExportAchDto) {
    const result = await this.bank_export_service.exportBatch(
      +id,
      dto.bank,
      dto.source_account,
      dto.source_account_type,
    );
    return this.response_service.success(
      result,
      'ACH file generated successfully',
    );
  }
}
