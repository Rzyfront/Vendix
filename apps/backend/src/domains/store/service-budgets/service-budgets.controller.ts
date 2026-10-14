import { Controller, Get, Param, ParseIntPipe, Put, Body, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ServiceBudgetsService } from './service-budgets.service';
import { SetServiceBudgetDto } from './dto/set-service-budget.dto';

@Controller('store/service-sessions')
@UseGuards(PermissionsGuard)
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
}
