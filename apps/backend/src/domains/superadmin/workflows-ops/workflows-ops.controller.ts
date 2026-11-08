import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '../../../common/responses/response.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WorkflowsOpsAlertsQueryDto } from './dto/workflows-ops-alerts-query.dto';
import { WorkflowsOpsMetricsService } from './workflows-ops-metrics.service';

/** Platform-wide by design (every store): SUPER_ADMIN only. */
@ApiTags('Superadmin Workflows Ops')
@Controller('superadmin/workflows-ops')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class WorkflowsOpsController {
  constructor(
    private readonly metrics: WorkflowsOpsMetricsService,
    private readonly prisma: StorePrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Queue, latency, dead-letter and webhook figures of all stores' })
  async getMetrics() {
    const data = await this.metrics.getMetrics();
    return this.responseService.success(data, 'Workflow operations metrics retrieved');
  }

  @Get('alerts')
  @ApiOperation({ summary: 'History of the platform alerts for Flujos' })
  async getAlerts(@Query() query: WorkflowsOpsAlertsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const db = this.prisma.withoutScope();
    const [rows, total] = await Promise.all([
      db.workflow_ops_alerts.findMany({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          rule: true,
          severity: true,
          title: true,
          details: true,
          recipients: true,
          created_at: true,
        },
      }),
      db.workflow_ops_alerts.count(),
    ]);
    return this.responseService.paginated(rows, total, page, limit, 'Workflow alerts retrieved');
  }
}
