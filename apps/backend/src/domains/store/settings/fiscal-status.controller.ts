import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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

@ApiTags('Store Settings — Fiscal Status')
@Controller('store/settings/fiscal-status')
@UseGuards(PermissionsGuard)
export class FiscalStatusController {
  constructor(
    private readonly fiscalStatus: FiscalStatusService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:fiscal_status:read')
  @ApiOperation({ summary: 'Read fiscal status for the current store' })
  async read() {
    const data = await this.fiscalStatus.read(
      this.requireOrganizationId(),
      this.requireStoreId(),
    );
    return this.response.success(data);
  }

  @Post(':area/start-wizard')
  @Permissions('store:settings:fiscal_status:write')
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
      store_id: this.requireStoreId(),
      selected_areas,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal wizard started');
  }

  @Post(':area/advance-step')
  @Permissions('store:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Persist a fiscal activation wizard step' })
  async advanceStep(
    @Param('area') _area: FiscalArea,
    @Body() body: AdvanceFiscalWizardStepDto,
  ) {
    const data = await this.fiscalStatus.advanceStep({
      organization_id: this.requireOrganizationId(),
      store_id: this.requireStoreId(),
      step: body.step,
      data: body.data,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal wizard step saved');
  }

  @Post(':area/finalize')
  @Permissions('store:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Finalize fiscal activation wizard' })
  async finalize(
    @Param('area') area: FiscalArea,
    @Body() body: FinalizeFiscalWizardDto,
  ) {
    const data = await this.fiscalStatus.finalizeActivation({
      organization_id: this.requireOrganizationId(),
      store_id: this.requireStoreId(),
      selected_areas: body.selected_areas?.length ? body.selected_areas : [area],
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal status activated');
  }

  @Post(':area/deactivate')
  @Permissions('store:settings:fiscal_status:write')
  @ApiOperation({ summary: 'Deactivate a fiscal area if it is not locked' })
  async deactivate(@Param('area') area: FiscalArea) {
    const data = await this.fiscalStatus.attemptDeactivation({
      organization_id: this.requireOrganizationId(),
      store_id: this.requireStoreId(),
      area,
      changed_by_user_id: this.requireUserId(),
    });
    return this.response.success(data, 'Fiscal status deactivated');
  }

  @Get(':area/irreversibility-check')
  @Permissions('store:settings:fiscal_status:read')
  @ApiOperation({ summary: 'Check whether fiscal status is irreversible' })
  async irreversibilityCheck(@Param('area') area: FiscalArea) {
    const data = await this.fiscalStatus.checkIrreversibility({
      organization_id: this.requireOrganizationId(),
      store_id: this.requireStoreId(),
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

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.SYS_UNAUTHORIZED_001);
    }
    return userId;
  }
}
