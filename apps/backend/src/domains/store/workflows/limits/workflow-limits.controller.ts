import { Controller, Get, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowUsageService } from './workflow-usage.service';

/** P7.1: what the store used this month against the limits of its plan. */
@Controller('store/workflows/usage')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowLimitsController {
  constructor(
    private readonly usage: WorkflowUsageService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async get() {
    return this.responseService.success(await this.usage.snapshot());
  }
}
