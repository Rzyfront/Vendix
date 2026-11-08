import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowAiUsageQueryDto } from './dto/workflow-ai-usage.dto';
import { WorkflowAiUsageService } from './workflow-ai-usage.service';

/** P6.3: AI tokens spent by Flows in one UTC month, by flow and by purpose. */
@Controller('store/workflows/ai-usage')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowAiUsageController {
  constructor(
    private readonly usage: WorkflowAiUsageService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async get(@Query() query: WorkflowAiUsageQueryDto) {
    return this.responseService.success(await this.usage.report(query.month));
  }
}
