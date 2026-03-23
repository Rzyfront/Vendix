import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../../common/responses/response.service';
import { ConsolidationService } from './consolidation.service';
import { IntercompanyDetectionService } from './intercompany-detection.service';
import { ConsolidatedReportsService } from './consolidated-reports.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { QuerySessionDto } from './dto/query-session.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@Controller('store/accounting/consolidation')
@UseGuards(PermissionsGuard)
export class ConsolidationController {
  constructor(
    private readonly consolidation_service: ConsolidationService,
    private readonly intercompany_service: IntercompanyDetectionService,
    private readonly reports_service: ConsolidatedReportsService,
    private readonly response_service: ResponseService,
  ) {}

  // ===== SESSIONS =====

  @Get('sessions')
  @Permissions('store:accounting:consolidation:read')
  async findAllSessions(@Query() query_dto: QuerySessionDto) {
    const result = await this.consolidation_service.findAllSessions(query_dto);
    return this.response_service.success(result);
  }

  @Get('sessions/:id')
  @Permissions('store:accounting:consolidation:read')
  async findOneSession(@Param('id', ParseIntPipe) id: number) {
    const result = await this.consolidation_service.findOneSession(id);
    return this.response_service.success(result);
  }

  @Post('sessions')
  @Permissions('store:accounting:consolidation:write')
  async createSession(@Body() dto: CreateSessionDto) {
    const result = await this.consolidation_service.createSession(dto);
    return this.response_service.success(result);
  }

  @Patch('sessions/:id/start')
  @Permissions('store:accounting:consolidation:write')
  async startSession(@Param('id', ParseIntPipe) id: number) {
    const result = await this.consolidation_service.startSession(id);
    return this.response_service.success(result);
  }

  @Patch('sessions/:id/complete')
  @Permissions('store:accounting:consolidation:write')
  async completeSession(@Param('id', ParseIntPipe) id: number) {
    const result = await this.consolidation_service.completeSession(id);
    return this.response_service.success(result);
  }

  @Patch('sessions/:id/cancel')
  @Permissions('store:accounting:consolidation:write')
  async cancelSession(@Param('id', ParseIntPipe) id: number) {
    const result = await this.consolidation_service.cancelSession(id);
    return this.response_service.success(result);
  }

  // ===== INTERCOMPANY =====

  @Get('sessions/:id/intercompany')
  @Permissions('store:accounting:consolidation:read')
  async getDetectedTransactions(@Param('id', ParseIntPipe) id: number) {
    const result = await this.intercompany_service.getDetectedTransactions(id);
    return this.response_service.success(result);
  }

  @Post('sessions/:id/detect')
  @Permissions('store:accounting:consolidation:write')
  async detectTransactions(@Param('id', ParseIntPipe) id: number) {
    const result = await this.intercompany_service.detectTransactions(id);
    return this.response_service.success(result);
  }

  @Patch('sessions/:id/eliminate-all')
  @Permissions('store:accounting:consolidation:write')
  async eliminateAll(@Param('id', ParseIntPipe) id: number) {
    const result = await this.intercompany_service.eliminateAll(id);
    return this.response_service.success(result);
  }

  @Patch('intercompany/:txn_id/eliminate')
  @Permissions('store:accounting:consolidation:write')
  async eliminateTransaction(@Param('txn_id', ParseIntPipe) txn_id: number) {
    const result = await this.intercompany_service.eliminateTransaction(txn_id);
    return this.response_service.success(result);
  }

  // ===== AUTO-ELIMINATE =====

  @Post('sessions/:id/auto-eliminate')
  @Permissions('store:accounting:consolidation:write')
  async autoEliminateIntercompany(@Param('id', ParseIntPipe) id: number) {
    const result = await this.intercompany_service.autoEliminateIntercompany(id);
    return this.response_service.success(result);
  }

  // ===== DRILL-DOWN =====

  @Get('sessions/:id/transactions')
  @Permissions('store:accounting:consolidation:read')
  async getTransactionsDrilldown(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryTransactionsDto,
  ) {
    const result = await this.consolidation_service.getTransactionsDrilldown(id, query);
    return this.response_service.success(result);
  }

  // ===== EXPORT =====

  @Get('sessions/:id/export')
  @Permissions('store:accounting:consolidation:read')
  async exportConsolidation(@Param('id', ParseIntPipe) id: number) {
    const result = await this.consolidation_service.exportConsolidation(id);
    return this.response_service.success(result);
  }

  // ===== ADJUSTMENTS =====

  @Post('sessions/:id/adjustments')
  @Permissions('store:accounting:consolidation:write')
  async addManualAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAdjustmentDto,
  ) {
    const result = await this.consolidation_service.addManualAdjustment(id, dto);
    return this.response_service.success(result);
  }

  @Delete('adjustments/:adj_id')
  @Permissions('store:accounting:consolidation:write')
  async removeAdjustment(@Param('adj_id', ParseIntPipe) adj_id: number) {
    const result = await this.consolidation_service.removeAdjustment(adj_id);
    return this.response_service.success(result);
  }

  // ===== REPORTS =====

  @Get('sessions/:id/reports/trial-balance')
  @Permissions('store:accounting:consolidation:read')
  async getConsolidatedTrialBalance(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reports_service.getConsolidatedTrialBalance(id);
    return this.response_service.success(result);
  }

  @Get('sessions/:id/reports/balance-sheet')
  @Permissions('store:accounting:consolidation:read')
  async getConsolidatedBalanceSheet(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reports_service.getConsolidatedBalanceSheet(id);
    return this.response_service.success(result);
  }

  @Get('sessions/:id/reports/income-statement')
  @Permissions('store:accounting:consolidation:read')
  async getConsolidatedIncomeStatement(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reports_service.getConsolidatedIncomeStatement(id);
    return this.response_service.success(result);
  }

  @Get('sessions/:id/reports/eliminations')
  @Permissions('store:accounting:consolidation:read')
  async getEliminationDetail(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reports_service.getEliminationDetail(id);
    return this.response_service.success(result);
  }
}
