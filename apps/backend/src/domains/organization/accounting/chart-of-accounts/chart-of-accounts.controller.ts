import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
  SkipModuleFlowGuard,
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgChartOfAccountsService } from './chart-of-accounts.service';
import { CreateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/update-account.dto';
import { QueryAccountDto } from '../../../store/accounting/chart-of-accounts/dto/query-account.dto';
import { SeedDefaultChartDto } from '../../../store/accounting/chart-of-accounts/dto/seed-default-chart.dto';
import { DefaultChartOfAccountsSeederService } from '../../../../common/services/default-chart-of-accounts-seeder.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Org-native chart of accounts controller. Mirrors `/store/accounting/chart-of-accounts`
 * so the ORG_ADMIN frontend can read/write under its own domain.
 *
 * Optional `?store_id=<n>` query forces a per-store breakdown when the org
 * `operating_scope=ORGANIZATION` (read paths), or selects the target store
 * when `operating_scope=STORE` (read+write paths).
 */
@Controller('organization/accounting/chart-of-accounts')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgChartOfAccountsController {
  constructor(
    private readonly chartOfAccounts: OrgChartOfAccountsService,
    private readonly responseService: ResponseService,
    private readonly defaultChartSeeder: DefaultChartOfAccountsSeederService,
  ) {}

  @Get()
  @SkipModuleFlowGuard() // bootstrap: wizard loadInitial() reads chart while module still WIP
  @Permissions('organization:accounting:chart_of_accounts:read')
  async findAll(
    @Query() query: QueryAccountDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.chartOfAccounts.findAll(query, store_id);
    return this.responseService.success(result);
  }

  @Get('tree')
  @SkipModuleFlowGuard() // bootstrap: wizard previews tree during chart setup
  @Permissions('organization:accounting:chart_of_accounts:read')
  async getTree(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.chartOfAccounts.getTree(store_id);
    return this.responseService.success(result);
  }

  @Post('seed-default')
  @SkipModuleFlowGuard() // bootstrap: wizard uses this to seed PUC and activate module
  @Permissions('organization:accounting:chart_of_accounts:create')
  @HttpCode(HttpStatus.CREATED)
  async seedDefault(
    @Body() body: SeedDefaultChartDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'Organization context required to seed default chart of accounts.',
      );
    }
    const result = await this.defaultChartSeeder.seed({
      organization_id,
      store_id: storeIdRaw ? Number(storeIdRaw) : undefined,
      force: body.force,
    });
    return this.responseService.created(
      result,
      'Default chart of accounts seeded successfully',
    );
  }

  @Get(':id')
  @Permissions('organization:accounting:chart_of_accounts:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.chartOfAccounts.findOne(id, store_id);
    return this.responseService.success(result);
  }

  @Post()
  @SkipModuleFlowGuard() // bootstrap: wizard may create individual PUC accounts before module is ACTIVE; ambiguous bootstrap-vs-daily-use, kept skipped because creating accounts is part of initial setup
  @Permissions('organization:accounting:chart_of_accounts:create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateAccountDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.chartOfAccounts.create(dto, store_id);
    return this.responseService.success(result, 'Account created successfully');
  }

  @Put(':id')
  @Permissions('organization:accounting:chart_of_accounts:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.chartOfAccounts.update(id, dto, store_id);
    return this.responseService.success(result, 'Account updated successfully');
  }

  @Delete(':id')
  @Permissions('organization:accounting:chart_of_accounts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    await this.chartOfAccounts.remove(id, store_id);
    return this.responseService.success(null, 'Account deleted successfully');
  }
}
