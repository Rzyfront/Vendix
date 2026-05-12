import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  CreateAdvanceDto,
  ApproveAdvanceDto,
  QueryAdvanceDto,
  RegisterAdvancePaymentDto,
} from './dto';

@Controller('store/payroll/advances')
@UseGuards(PermissionsGuard)
export class AdvancesController {
  constructor(
    private readonly advances_service: AdvancesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:payroll:advances:read')
  async findAll(@Query() query_dto: QueryAdvanceDto) {
    const result = await this.advances_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  @Permissions('store:payroll:advances:read')
  async getStats() {
    const result = await this.advances_service.getStats();
    return this.response_service.success(result);
  }

  @Get('employee/:employeeId/summary')
  @Permissions('store:payroll:advances:read')
  async getEmployeeAdvanceSummary(@Param('employeeId') employeeId: string) {
    const result =
      await this.advances_service.getEmployeeAdvanceSummary(+employeeId);
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  @Permissions('store:payroll:advances:read')
  async findOne(@Param('id') id: string) {
    const result = await this.advances_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:payroll:advances:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateAdvanceDto) {
    const result = await this.advances_service.create(create_dto);
    return this.response_service.created(
      result,
      'Advance created successfully',
    );
  }

  @Patch(':id/approve')
  @Permissions('store:payroll:advances:approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveAdvanceDto) {
    const result = await this.advances_service.approve(+id, dto);
    return this.response_service.success(
      result,
      'Advance approved successfully',
    );
  }

  @Patch(':id/reject')
  @Permissions('store:payroll:advances:approve')
  async reject(@Param('id') id: string) {
    const result = await this.advances_service.reject(+id);
    return this.response_service.success(result, 'Advance rejected');
  }

  @Patch(':id/cancel')
  @Permissions('store:payroll:advances:manage')
  async cancel(@Param('id') id: string) {
    const result = await this.advances_service.cancel(+id);
    return this.response_service.success(result, 'Advance cancelled');
  }

  @Post(':id/pay')
  @Permissions('store:payroll:advances:manage')
  @HttpCode(HttpStatus.OK)
  async registerManualPayment(
    @Param('id') id: string,
    @Body() dto: RegisterAdvancePaymentDto,
  ) {
    const result = await this.advances_service.registerManualPayment(+id, dto);
    return this.response_service.success(
      result,
      'Payment registered successfully',
    );
  }

  @Patch(':id/installments/:installmentId/pay')
  @Permissions('store:payroll:advances:manage')
  async payInstallment(
    @Param('id') id: string,
    @Param('installmentId') installmentId: string,
    @Body() dto: RegisterAdvancePaymentDto,
  ) {
    const result = await this.advances_service.payInstallment(
      +id,
      +installmentId,
      dto,
    );
    return this.response_service.success(
      result,
      'Installment payment registered',
    );
  }
}
