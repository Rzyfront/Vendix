import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestContextService } from '@common/context/request-context.service';
import {
  AdvanceFiscalWizardStepDto,
  FinalizeFiscalWizardDto,
  StartFiscalWizardDto,
} from '@common/dto/fiscal-status.dto';
import { FiscalArea } from '@common/interfaces/fiscal-status.interface';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Settings — Fiscal Status')
@Controller('organization/settings/fiscal-status')
@UseGuards(PermissionsGuard)
export class FiscalStatusController {
  constructor(
    private readonly fiscalStatus: FiscalStatusService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:settings:fiscal_status:read')
  @ApiOperation({ summary: 'Read fiscal status for the current organization' })
  async read() {
    const data = await this.fiscalStatus.read(this.requireOrganizationId());
    return this.response.success(data);
  }

  @Post(':area/start-wizard')
  @Permissions('organization:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Start fiscal activation wizard for one or more areas' })
  async startWizard(
    @Param('area') area: FiscalArea,
    @Body() body: StartFiscalWizardDto,
  ) {
    const selected_areas = body.selected_areas?.length
      ? body.selected_areas
      : [area];
    const data = await this.fiscalStatus.startWizard({
      organization_id: this.requireOrganizationId(),
      store_id: body.store_id ?? null,
      selected_areas,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal wizard started');
  }

  @Post(':area/advance-step')
  @Permissions('organization:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Persist a fiscal activation wizard step' })
  async advanceStep(
    @Param('area') _area: FiscalArea,
    @Body() body: AdvanceFiscalWizardStepDto,
  ) {
    const data = await this.fiscalStatus.advanceStep({
      organization_id: this.requireOrganizationId(),
      store_id: body.store_id ?? null,
      step: body.step,
      data: body.data,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal wizard step saved');
  }

  @Post(':area/finalize')
  @Permissions('organization:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Finalize fiscal activation wizard' })
  async finalize(
    @Param('area') area: FiscalArea,
    @Body() body: FinalizeFiscalWizardDto,
  ) {
    const data = await this.fiscalStatus.finalizeActivation({
      organization_id: this.requireOrganizationId(),
      store_id: body.store_id ?? null,
      selected_areas: body.selected_areas?.length ? body.selected_areas : [area],
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal status activated');
  }

  @Post(':area/deactivate')
  @Permissions('organization:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Deactivate a fiscal area if it is not locked' })
  async deactivate(
    @Param('area') area: FiscalArea,
    @Body() body: FinalizeFiscalWizardDto,
  ) {
    const data = await this.fiscalStatus.attemptDeactivation({
      organization_id: this.requireOrganizationId(),
      store_id: body.store_id ?? null,
      area,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal status deactivated');
  }

  @Get(':area/irreversibility-check')
  @Permissions('organization:settings:fiscal_status:read')
  @ApiOperation({ summary: 'Check whether fiscal status is irreversible' })
  async irreversibilityCheck(
    @Param('area') area: FiscalArea,
    @Query('store_id') storeId?: string,
  ) {
    const data = await this.fiscalStatus.checkIrreversibility({
      organization_id: this.requireOrganizationId(),
      store_id: storeId ? Number(storeId) : null,
      area,
    });
    return this.response.success(data);
  }

  private requireOrganizationId(): number {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return organizationId;
  }

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.SYS_UNAUTHORIZED_001);
    }
    return userId;
  }
}
