import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgAccountMappingsService } from './account-mappings.service';
import {
  UpsertAccountMappingDto,
  ResetAccountMappingDto,
} from '../../../store/accounting/account-mappings/dto/upsert-account-mapping.dto';

/**
 * Org-native account mappings controller. Maps to
 * `/api/organization/accounting/mappings/*`.
 *
 * Read/write at organization level by default; the optional `store_id`
 * payload narrows to a per-store override (when the org operates in
 * STORE mode or when a specific store needs an exception under
 * ORGANIZATION mode).
 */
@Controller('organization/accounting/mappings')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgAccountMappingsController {
  constructor(
    private readonly mappings: OrgAccountMappingsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:accounting:account_mappings:read')
  async getMappings(
    @Query('prefix') prefix?: string,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.mappings.getMappings(prefix, store_id);
    return this.responseService.success(result);
  }

  @Put()
  @Permissions('organization:accounting:account_mappings:update')
  async bulkUpsertMappings(@Body() dto: UpsertAccountMappingDto) {
    const result = await this.mappings.bulkUpsertMappings(
      dto.mappings,
      dto.store_id,
    );
    return this.responseService.success(
      result,
      'Mappings updated successfully',
    );
  }

  @Post('reset')
  @Permissions('organization:accounting:account_mappings:create')
  @HttpCode(HttpStatus.OK)
  async resetToDefaults(@Body() dto: ResetAccountMappingDto) {
    await this.mappings.resetToDefaults(dto.store_id);
    return this.responseService.success(null, 'Mappings reset to defaults');
  }
}
