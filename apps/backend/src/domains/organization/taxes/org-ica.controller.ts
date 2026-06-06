import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../common/responses/response.service';

import { OrgIcaService } from './org-ica.service';
import {
  IcaRatesQueryDto,
  IcaCalculateDto,
  IcaReportQueryDto,
} from '../../store/taxes/dto';

/**
 * Org-native ICA municipal controller. Mirrors `/store/taxes/ica` so the
 * ORG_ADMIN frontend can read rates, resolve/calculate ICA, and pull
 * consolidated reports under its own domain.
 *
 * Optional `?store_id=<n>` forces a per-store breakdown when the org runs
 * `fiscal_scope=ORGANIZATION` (resolve/report paths), or selects the target
 * store when `fiscal_scope=STORE`.
 */
@Controller('organization/taxes/ica')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgIcaController {
  constructor(
    private readonly ica_service: OrgIcaService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('rates')
  @Permissions('organization:taxes:ica:read')
  async findAllRates(@Query() query: IcaRatesQueryDto) {
    const result = await this.ica_service.findAllRates(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Tarifas ICA obtenidas exitosamente',
    );
  }

  @Get('resolve')
  @Permissions('organization:taxes:ica:read')
  async resolveStoreRate(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ica_service.resolveStoreIcaRate(store_id);
    return this.response_service.success(
      result,
      'Tarifa ICA resuelta exitosamente',
    );
  }

  @Post('calculate')
  @Permissions('organization:taxes:ica:read')
  async calculateICA(@Body() dto: IcaCalculateDto) {
    const result = await this.ica_service.calculateICA(dto);
    return this.response_service.success(result, 'ICA calculado exitosamente');
  }

  @Get('report')
  @Permissions('organization:taxes:ica:report')
  async getIcaReport(
    @Query() query: IcaReportQueryDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ica_service.getIcaReport(query, store_id);
    return this.response_service.success(
      result,
      'Reporte ICA generado exitosamente',
    );
  }
}
