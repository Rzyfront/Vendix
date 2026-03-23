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
import { CreateAdvanceDto, ApproveAdvanceDto, QueryAdvanceDto, RegisterAdvancePaymentDto } from './dto';

@Controller('store/payroll/advances')
@UseGuards(PermissionsGuard)
export class AdvancesController {
  constructor(
    private readonly advances_service: AdvancesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('payroll:read')
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
  @Permissions('payroll:read')
  async getStats() {
    const result = await this.advances_service.getStats();
    return this.response_service.success(result);
  }

  @Get('employee/:employeeId/summary')
  @Permissions('payroll:read')
  async getEmployeeAdvanceSummary(@Param('employeeId') employeeId: string) {
    const result = await this.advances_service.getEmployeeAdvanceSummary(+employeeId);
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  @Permissions('payroll:read')
  async findOne(@Param('id') id: string) {
    const result = await this.advances_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('payroll:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateAdvanceDto) {
    const result = await this.advances_service.create(create_dto);
    return this.response_service.created(result, 'Advance created successfully');
  }

  @Patch(':id/approve')
  @Permissions('payroll:write')
  async approve(@Param('id') id: string, @Body() dto: ApproveAdvanceDto) {
    const result = await this.advances_service.approve(+id, dto);
    return this.response_service.success(result, 'Advance approved successfully');
  }

  @Patch(':id/reject')
  @Permissions('payroll:write')
  async reject(@Param('id') id: string) {
    const result = await this.advances_service.reject(+id);
    return this.response_service.success(result, 'Advance rejected');
  }

  @Patch(':id/cancel')
  @Permissions('payroll:write')
  async cancel(@Param('id') id: string) {
    const result = await this.advances_service.cancel(+id);
    return this.response_service.success(result, 'Advance cancelled');
  }

  @Post(':id/pay')
  @Permissions('payroll:write')
  @HttpCode(HttpStatus.OK)
  async registerManualPayment(
    @Param('id') id: string,
    @Body() dto: RegisterAdvancePaymentDto,
  ) {
    const result = await this.advances_service.registerManualPayment(+id, dto);
    return this.response_service.success(result, 'Payment registered successfully');
  }
}
