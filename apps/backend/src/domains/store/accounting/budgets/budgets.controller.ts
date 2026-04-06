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
import { BudgetsService } from './budgets.service';
import { BudgetVarianceService } from './budget-variance.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { UpdateBudgetLinesDto } from './dto/update-budget-lines.dto';
import { QueryBudgetDto } from './dto/query-budget.dto';
import { VarianceQueryDto } from './dto/variance-query.dto';

@Controller('store/accounting/budgets')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class BudgetsController {
  constructor(
    private readonly budgets_service: BudgetsService,
    private readonly variance_service: BudgetVarianceService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:budgets:read')
  async findAll(@Query() query: QueryBudgetDto) {
    const result = await this.budgets_service.findAll(query);
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:accounting:budgets:read')
  async findOne(@Param('id') id: string) {
    const result = await this.budgets_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:budgets:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBudgetDto) {
    const result = await this.budgets_service.create(dto);
    return this.response_service.success(result, 'Budget created successfully');
  }

  @Patch(':id')
  @Permissions('store:accounting:budgets:update')
  async update(@Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    const result = await this.budgets_service.update(+id, dto);
    return this.response_service.success(result, 'Budget updated successfully');
  }

  @Patch(':id/lines')
  @Permissions('store:accounting:budgets:update')
  async updateLines(
    @Param('id') id: string,
    @Body() dto: UpdateBudgetLinesDto,
  ) {
    const result = await this.budgets_service.updateLines(+id, dto);
    return this.response_service.success(
      result,
      'Budget lines updated successfully',
    );
  }

  @Patch(':id/approve')
  @Permissions('store:accounting:budgets:update')
  async approve(@Param('id') id: string) {
    const result = await this.budgets_service.approve(+id);
    return this.response_service.success(
      result,
      'Budget approved successfully',
    );
  }

  @Patch(':id/activate')
  @Permissions('store:accounting:budgets:update')
  async activate(@Param('id') id: string) {
    const result = await this.budgets_service.activate(+id);
    return this.response_service.success(
      result,
      'Budget activated successfully',
    );
  }

  @Patch(':id/close')
  @Permissions('store:accounting:budgets:update')
  async close(@Param('id') id: string) {
    const result = await this.budgets_service.close(+id);
    return this.response_service.success(result, 'Budget closed successfully');
  }

  @Delete(':id')
  @Permissions('store:accounting:budgets:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.budgets_service.remove(+id);
    return this.response_service.success(null, 'Budget deleted successfully');
  }

  @Post(':id/duplicate')
  @Permissions('store:accounting:budgets:create')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(
    @Param('id') id: string,
    @Body() body: { fiscal_period_id: number },
  ) {
    const result = await this.budgets_service.duplicate(
      +id,
      body.fiscal_period_id,
    );
    return this.response_service.success(
      result,
      'Budget duplicated successfully',
    );
  }

  @Get(':id/variance')
  @Permissions('store:accounting:budgets:read')
  async getVarianceReport(
    @Param('id') id: string,
    @Query() query: VarianceQueryDto,
  ) {
    const result = await this.variance_service.getVarianceReport(
      +id,
      query.month,
    );
    return this.response_service.success(result);
  }

  @Get(':id/monthly-trend')
  @Permissions('store:accounting:budgets:read')
  async getMonthlyTrend(@Param('id') id: string) {
    const result = await this.variance_service.getMonthlyTrend(+id);
    return this.response_service.success(result);
  }

  @Get(':id/alerts')
  @Permissions('store:accounting:budgets:read')
  async getVarianceAlerts(@Param('id') id: string) {
    const result = await this.variance_service.getVarianceAlerts(+id);
    return this.response_service.success(result);
  }
}
