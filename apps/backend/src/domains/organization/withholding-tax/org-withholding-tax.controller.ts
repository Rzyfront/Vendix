import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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

import { OrgWithholdingTaxService } from './org-withholding-tax.service';
import {
  CreateWithholdingConceptDto,
  UpdateWithholdingConceptDto,
  CalculateWithholdingDto,
} from '../../store/withholding-tax/dto';

/**
 * Org-native withholding-tax controller. Mirrors `/store/withholding-tax`
 * so the ORG_ADMIN frontend can read/write under its own domain.
 *
 * Optional `?store_id=<n>` query forces a per-store breakdown when the org
 * `fiscal_scope=ORGANIZATION` (read paths), or selects the target store
 * when `fiscal_scope=STORE` (read+write paths).
 */
@Controller('organization/withholding-tax')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgWithholdingTaxController {
  constructor(
    private readonly withholdingTax: OrgWithholdingTaxService,
    private readonly responseService: ResponseService,
  ) {}

  // ===== Concepts =====

  @Get('concepts')
  @Permissions('organization:withholding:read')
  async findAllConcepts(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.findAllConcepts(store_id);
    return this.responseService.success(result);
  }

  @Post('concepts')
  @Permissions('organization:withholding:write')
  async createConcept(
    @Body() dto: CreateWithholdingConceptDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.createConcept(dto, store_id);
    return this.responseService.success(
      result,
      'Withholding concept created successfully',
    );
  }

  @Put('concepts/:id')
  @Permissions('organization:withholding:write')
  async updateConcept(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWithholdingConceptDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.updateConcept(id, dto, store_id);
    return this.responseService.success(
      result,
      'Withholding concept updated successfully',
    );
  }

  @Delete('concepts/:id')
  @Permissions('organization:withholding:write')
  async deactivateConcept(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.deactivateConcept(id, store_id);
    return this.responseService.success(
      result,
      'Withholding concept deactivated successfully',
    );
  }

  // ===== UVT Values =====

  @Get('uvt-values')
  @Permissions('organization:withholding:read')
  async findAllUvt(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.findAllUvt(store_id);
    return this.responseService.success(result);
  }

  @Post('uvt-values')
  @Permissions('organization:withholding:write')
  async createUvt(
    @Body() body: { year: number; value_cop: number },
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.createUvt(body, store_id);
    return this.responseService.success(
      result,
      'UVT value saved successfully',
    );
  }

  // ===== Calculate =====

  @Post('calculate')
  @Permissions('organization:withholding:read')
  async calculateWithholding(
    @Body() dto: CalculateWithholdingDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.calculateWithholding(dto, store_id);
    return this.responseService.success(result);
  }

  // ===== Stats =====

  @Get('stats')
  @Permissions('organization:withholding:read')
  async getStats(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.withholdingTax.getStats(store_id);
    return this.responseService.success(result);
  }
}
