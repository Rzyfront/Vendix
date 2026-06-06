import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../common/responses/response.service';

import { OrgExogenousService } from './org-exogenous.service';
import {
  GenerateReportDto,
  QueryReportsDto,
} from '../../store/exogenous/dto';

/**
 * Org-native DIAN exogenous controller. Mirrors `/store/exogenous` so the
 * ORG_ADMIN frontend can read/write under its own domain.
 *
 * Optional `?store_id=<n>` query forces a per-store breakdown when the org
 * `fiscal_scope=ORGANIZATION`, or selects the target store when
 * `fiscal_scope=STORE`.
 */
@Controller('organization/exogenous')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgExogenousController {
  constructor(
    private readonly exogenousService: OrgExogenousService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('reports')
  @Permissions('organization:exogenous:read')
  async getReports(
    @Query() query: QueryReportsDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.getReports(query, store_id);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Post('reports/generate')
  @Permissions('organization:exogenous:write')
  async generateReport(
    @Body() dto: GenerateReportDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.generateReport(dto, store_id);
    return this.responseService.success(
      result,
      'Report generated successfully',
    );
  }

  @Get('reports/:id')
  @Permissions('organization:exogenous:read')
  async getReport(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.getReport(id, store_id);
    return this.responseService.success(result);
  }

  @Get('reports/:id/lines')
  @Permissions('organization:exogenous:read')
  async getReportLines(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.getReportLines(
      id,
      +(page || 1),
      +(limit || 50),
      store_id,
    );
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Post('reports/:id/submit')
  @Permissions('organization:exogenous:submit')
  async submitReport(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.submitReport(id, store_id);
    return this.responseService.success(result, 'Report marked as submitted');
  }

  @Get('validate/:year')
  @Permissions('organization:exogenous:read')
  async validateYear(
    @Param('year', ParseIntPipe) year: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.validateYear(year, store_id);
    return this.responseService.success(result);
  }

  @Get('stats/:year')
  @Permissions('organization:exogenous:read')
  async getStats(
    @Param('year', ParseIntPipe) year: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.exogenousService.getStats(year, store_id);
    return this.responseService.success(result);
  }
}
