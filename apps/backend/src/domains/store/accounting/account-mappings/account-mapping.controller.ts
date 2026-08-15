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
  Put,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  AccountMappingService,
  buildMappingKeyCatalog,
} from './account-mapping.service';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  UpsertAccountMappingDto,
  ResetAccountMappingDto,
} from './dto/upsert-account-mapping.dto';
import { RequestContextService } from '../../../../common/context/request-context.service';

@Controller('store/accounting/account-mappings')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class AccountMappingController {
  constructor(
    private readonly account_mapping_service: AccountMappingService,
    private readonly response_service: ResponseService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Canonical catalog of every mapping key the accounting engine understands
   * (`key`, human `label`, `event`/`role` split and the default PUC code).
   *
   * Exists so the frontend stops re-declaring its own partial copy of
   * `DEFAULT_ACCOUNT_MAPPINGS`. Static data — no tenant reads — so it is safe
   * behind the read permission and skips the module-flow gate like the other
   * bootstrap routes the wizard needs.
   *
   * Declared BEFORE `@Get()` has no bearing here (there is no `:param` route
   * in this controller), but it is kept first to follow the repo convention of
   * static routes ahead of dynamic ones.
   */
  @Get('keys')
  @SkipModuleFlowGuard() // bootstrap: wizard renders the mapping form while module is still WIP
  @Permissions('store:accounting:account_mappings:read')
  getMappingKeys() {
    return this.response_service.success(buildMappingKeyCatalog());
  }

  @Get()
  @SkipModuleFlowGuard() // bootstrap: wizard reads current mapping state during setup
  @Permissions('store:accounting:account_mappings:read')
  async getMappings(
    @Query('prefix') prefix?: string,
    @Query('store_id') store_id?: string,
  ) {
    const context = this.getContext();
    const parsed_store_id = store_id ? +store_id : undefined;

    const result = await this.account_mapping_service.getMappings(
      context.organization_id!,
      prefix,
      parsed_store_id,
    );
    return this.response_service.success(result);
  }

  @Put()
  @SkipModuleFlowGuard() // bootstrap: wizard bulk-upserts mappings to satisfy ACTIVE requirements
  @Permissions('store:accounting:account_mappings:update')
  async bulkUpsertMappings(@Body() dto: UpsertAccountMappingDto) {
    const context = this.getContext();

    const result = await this.account_mapping_service.bulkUpsertMappings(
      context.organization_id!,
      dto.mappings,
      dto.store_id,
    );
    return this.response_service.success(
      result,
      'Mappings updated successfully',
    );
  }

  @Post('reset')
  @SkipModuleFlowGuard() // bootstrap: wizard may reset mappings to defaults during setup
  @Permissions('store:accounting:account_mappings:create')
  @HttpCode(HttpStatus.OK)
  async resetToDefaults(@Body() dto: ResetAccountMappingDto) {
    const context = this.getContext();

    await this.account_mapping_service.resetToDefaults(
      context.organization_id!,
      dto.store_id,
    );
    return this.response_service.success(null, 'Mappings reset to defaults');
  }
}
