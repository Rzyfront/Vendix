import { Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowInsightsListQueryDto } from './dto/workflow-ai-usage.dto';
import { WorkflowInsightsService } from './workflow-insights.service';

const MANAGE = 'store:workflows:manage';

interface InsightsRequest {
  user?: {
    roles?: string[];
    permissions?: Array<{ name: string; status: string }>;
  };
}

/** P6.4: weekly AI summaries of the Flows analytics and their on-demand generation. */
@Controller('store/workflows/insights')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowInsightsController {
  constructor(
    private readonly insights: WorkflowInsightsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summaries')
  @Permissions('store:workflows:read')
  async list(@Query() query: WorkflowInsightsListQueryDto, @Req() req: InsightsRequest) {
    return this.responseService.success(await this.insights.list(query.limit ?? 12, canManage(req)));
  }

  @Post('summaries/generate')
  @HttpCode(200)
  @Permissions(MANAGE)
  async generate() {
    return this.responseService.success(await this.insights.generateManual());
  }
}

function canManage(req: InsightsRequest): boolean {
  const user = req.user;
  if (!user) return false;
  if (user.roles?.includes(UserRole.SUPER_ADMIN)) return true;
  return !!user.permissions?.some((p) => p.name === MANAGE && p.status === 'active');
}
