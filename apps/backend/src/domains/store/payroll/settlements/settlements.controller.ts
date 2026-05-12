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
import { SettlementsService } from './settlements.service';
import { SettlementFlowService } from './settlement-flow.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { QuerySettlementDto } from './dto/query-settlement.dto';
import { ApproveSettlementDto } from './dto/approve-settlement.dto';

@Controller('store/payroll/settlements')
@UseGuards(PermissionsGuard)
export class SettlementsController {
  constructor(
    private readonly settlements_service: SettlementsService,
    private readonly settlement_flow_service: SettlementFlowService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:payroll:settlements:read')
  async findAll(@Query() query_dto: QuerySettlementDto) {
    const result = await this.settlements_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  @Permissions('store:payroll:settlements:read')
  async getStats() {
    const result = await this.settlements_service.getStats();
    return this.response_service.success(result);
  }

  // --- Parameter Routes ---

  @Get(':id')
  @Permissions('store:payroll:settlements:read')
  async findOne(@Param('id') id: string) {
    const result = await this.settlements_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:payroll:settlements:create')
  @HttpCode(HttpStatus.CREATED)
  async createAndCalculate(@Body() create_dto: CreateSettlementDto) {
    const result =
      await this.settlement_flow_service.createAndCalculate(create_dto);
    return this.response_service.success(
      result,
      'Settlement created and calculated successfully',
    );
  }

  @Post(':id/recalculate')
  @Permissions('store:payroll:settlements:manage')
  async recalculate(@Param('id') id: string) {
    const result = await this.settlement_flow_service.recalculate(+id);
    return this.response_service.success(
      result,
      'Settlement recalculated successfully',
    );
  }

  @Patch(':id/approve')
  @Permissions('store:payroll:settlements:manage')
  async approve(
    @Param('id') id: string,
    @Body() approve_dto: ApproveSettlementDto,
  ) {
    const result = await this.settlement_flow_service.approve(+id, approve_dto);
    return this.response_service.success(
      result,
      'Settlement approved successfully',
    );
  }

  @Patch(':id/pay')
  @Permissions('store:payroll:settlements:manage')
  async pay(@Param('id') id: string) {
    const result = await this.settlement_flow_service.pay(+id);
    return this.response_service.success(
      result,
      'Settlement paid successfully',
    );
  }

  @Patch(':id/cancel')
  @Permissions('store:payroll:settlements:manage')
  async cancel(@Param('id') id: string) {
    const result = await this.settlement_flow_service.cancel(+id);
    return this.response_service.success(
      result,
      'Settlement cancelled successfully',
    );
  }
}
