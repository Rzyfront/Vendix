import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
  SkipModuleFlowGuard,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { DefaultChartOfAccountsSeederService } from '../../../../common/services/default-chart-of-accounts-seeder.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { SeedDefaultChartDto } from './dto/seed-default-chart.dto';

@Controller('store/accounting/chart-of-accounts')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class ChartOfAccountsController {
  constructor(
    private readonly chart_of_accounts_service: ChartOfAccountsService,
    private readonly response_service: ResponseService,
    private readonly default_chart_seeder: DefaultChartOfAccountsSeederService,
  ) {}

  @Get()
  @SkipModuleFlowGuard() // bootstrap: wizard loadInitial() reads chart while module still WIP
  @Permissions('store:accounting:chart_of_accounts:read')
  async findAll(@Query() query_dto: QueryAccountDto) {
    const result = await this.chart_of_accounts_service.findAll(query_dto);
    return this.response_service.success(result);
  }

  // --- Static routes BEFORE :id ---

  @Get('tree')
  @SkipModuleFlowGuard() // bootstrap: wizard previews tree during chart setup
  @Permissions('store:accounting:chart_of_accounts:read')
  async getTree() {
    const result = await this.chart_of_accounts_service.getTree();
    return this.response_service.success(result);
  }

  @Post('seed-default')
  @SkipModuleFlowGuard() // bootstrap: wizard uses this to seed PUC and activate module
  @Permissions('store:accounting:chart_of_accounts:create')
  @HttpCode(HttpStatus.CREATED)
  async seedDefault(@Body() body: SeedDefaultChartDto) {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'Organization context required to seed default chart of accounts.',
      );
    }
    const store_id = RequestContextService.getStoreId();
    const result = await this.default_chart_seeder.seed({
      organization_id,
      store_id,
      force: body.force,
    });
    return this.response_service.created(
      result,
      'Default chart of accounts seeded successfully',
    );
  }

  // --- Parameter routes ---

  @Get(':id')
  @Permissions('store:accounting:chart_of_accounts:read')
  async findOne(@Param('id') id: string) {
    const result = await this.chart_of_accounts_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @SkipModuleFlowGuard() // bootstrap: wizard may create individual PUC accounts before module is ACTIVE; ambiguous bootstrap-vs-daily-use, kept skipped because creating accounts is part of initial setup
  @Permissions('store:accounting:chart_of_accounts:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateAccountDto) {
    const result = await this.chart_of_accounts_service.create(create_dto);
    return this.response_service.success(
      result,
      'Account created successfully',
    );
  }

  @Put(':id')
  @Permissions('store:accounting:chart_of_accounts:update')
  async update(@Param('id') id: string, @Body() update_dto: UpdateAccountDto) {
    const result = await this.chart_of_accounts_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Account updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:accounting:chart_of_accounts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.chart_of_accounts_service.remove(+id);
    return this.response_service.success(null, 'Account deleted successfully');
  }
}
