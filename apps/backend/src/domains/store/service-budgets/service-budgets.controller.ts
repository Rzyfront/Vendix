import { Controller, Get, Param, ParseIntPipe, Post, Put, Body, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ServiceBudgetsService } from './service-budgets.service';
import { SetServiceBudgetDto } from './dto/set-service-budget.dto';
import { CreateServiceProposalDto } from './dto/create-service-proposal.dto';

@Controller('store/service-sessions')
@UseGuards(PermissionsGuard, ServiceIndustryGuard)
export class ServiceBudgetsController {
  constructor(
    private readonly serviceBudgetsService: ServiceBudgetsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':id/budget')
  @Permissions('store:reservations:read')
  async getBudget(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.serviceBudgetsService.getBudget(id));
  }

  @Put(':id/budget')
  @Permissions('store:reservations:update')
  async setBudget(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetServiceBudgetDto,
  ) {
    return this.responseService.updated(
      await this.serviceBudgetsService.setBudget(id, dto),
      'Presupuesto guardado; requiere confirmar las reglas de consentimiento para aplicarlo.',
    );
  }

  @Get(':id/proposals')
  @Permissions('store:reservations:read')
  async listProposals(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.serviceBudgetsService.listProposals(id));
  }

  @Post(':id/proposals')
  @Permissions('store:reservations:update')
  async createProposal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateServiceProposalDto,
  ) {
    return this.responseService.created(
      await this.serviceBudgetsService.createProposal(id, dto),
      'Propuesta enviada al cliente para su autorización.',
    );
  }
}
