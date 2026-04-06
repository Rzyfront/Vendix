import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ModuleFlowGuard, RequireModuleFlow } from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
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
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationMatchingService } from './reconciliation-matching.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { ManualMatchDto } from './dto/manual-match.dto';

@Controller('store/accounting/bank-reconciliation/reconciliations')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class ReconciliationController {
  constructor(
    private readonly reconciliation_service: ReconciliationService,
    private readonly reconciliation_matching_service: ReconciliationMatchingService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:bank_reconciliation:read')
  async findAll(
    @Query('bank_account_id') bank_account_id?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.reconciliation_service.findAll({
      bank_account_id: bank_account_id ? +bank_account_id : undefined,
      status,
    });
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:accounting:bank_reconciliation:read')
  async findOne(@Param('id') id: string) {
    const result = await this.reconciliation_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:bank_reconciliation:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateReconciliationDto) {
    const result = await this.reconciliation_service.create(create_dto);
    return this.response_service.success(result, 'Reconciliation session created successfully');
  }

  @Post(':id/auto-match')
  @Permissions('store:accounting:bank_reconciliation:update')
  async autoMatch(@Param('id') id: string) {
    const result = await this.reconciliation_matching_service.autoMatch(+id);
    return this.response_service.success(result, 'Auto-matching completed');
  }

  @Post(':id/manual-match')
  @Permissions('store:accounting:bank_reconciliation:update')
  async manualMatch(
    @Param('id') id: string,
    @Body() dto: ManualMatchDto,
  ) {
    const result = await this.reconciliation_matching_service.manualMatch(+id, dto);
    return this.response_service.success(result, 'Manual match created');
  }

  @Post(':id/unmatch/:match_id')
  @Permissions('store:accounting:bank_reconciliation:update')
  async unmatch(
    @Param('id') id: string,
    @Param('match_id') match_id: string,
  ) {
    await this.reconciliation_matching_service.unmatch(+id, +match_id);
    return this.response_service.success(null, 'Match removed successfully');
  }

  @Patch(':id/complete')
  @Permissions('store:accounting:bank_reconciliation:update')
  async complete(@Param('id') id: string) {
    const result = await this.reconciliation_service.complete(+id);
    return this.response_service.success(result, 'Reconciliation completed successfully');
  }

  @Delete(':id')
  @Permissions('store:accounting:bank_reconciliation:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.reconciliation_service.remove(+id);
    return this.response_service.success(null, 'Reconciliation deleted successfully');
  }
}
