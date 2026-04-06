import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '../../../common/responses/response.service';
import { MonitoringOverviewService } from './services/monitoring-overview.service';
import { Ec2MetricsService } from './services/ec2-metrics.service';
import { RdsMetricsService } from './services/rds-metrics.service';
import { AppMetricsService } from './services/app-metrics.service';
import { ServerMetricsService } from './services/server-metrics.service';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { PerformanceMetricsService } from './services/performance-metrics.service';

@ApiTags('Monitoring')
@Controller('superadmin/monitoring')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class MonitoringController {
  constructor(
    private readonly overviewService: MonitoringOverviewService,
    private readonly ec2MetricsService: Ec2MetricsService,
    private readonly rdsMetricsService: RdsMetricsService,
    private readonly appMetricsService: AppMetricsService,
    private readonly serverMetricsService: ServerMetricsService,
    private readonly performanceMetricsService: PerformanceMetricsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get monitoring overview with health status' })
  @ApiResponse({ status: 200, description: 'Overview retrieved successfully' })
  async getOverview() {
    const data = await this.overviewService.getOverview();
    return this.responseService.success(data, 'Monitoring overview retrieved');
  }

  @Get('ec2')
  @ApiOperation({ summary: 'Get detailed EC2 instance metrics' })
  @ApiResponse({ status: 200, description: 'EC2 metrics retrieved successfully' })
  async getEc2Metrics(@Query() query: MetricsQueryDto) {
    const data = await this.ec2MetricsService.getDetailedMetrics(query);
    return this.responseService.success(data, 'EC2 metrics retrieved');
  }

  @Get('rds')
  @ApiOperation({ summary: 'Get detailed RDS database metrics' })
  @ApiResponse({ status: 200, description: 'RDS metrics retrieved successfully' })
  async getRdsMetrics(@Query() query: MetricsQueryDto) {
    const data = await this.rdsMetricsService.getDetailedMetrics(query);
    return this.responseService.success(data, 'RDS metrics retrieved');
  }

  @Get('app')
  @ApiOperation({ summary: 'Get application metrics (heap, queues, docker, redis)' })
  @ApiResponse({ status: 200, description: 'App metrics retrieved successfully' })
  async getAppMetrics() {
    const data = await this.appMetricsService.getAppMetrics();
    return this.responseService.success(data, 'Application metrics retrieved');
  }

  @Get('server')
  @ApiOperation({ summary: 'Get server system information' })
  @ApiResponse({ status: 200, description: 'Server info retrieved successfully' })
  async getServerInfo() {
    const data = this.serverMetricsService.getServerInfo();
    return this.responseService.success(data, 'Server info retrieved');
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get application performance metrics snapshot' })
  @ApiResponse({ status: 200, description: 'Performance metrics retrieved' })
  async getPerformance() {
    const data = this.performanceMetricsService.getPerformanceSnapshot();
    return this.responseService.success(data, 'Performance metrics retrieved');
  }

  @Get('performance/history')
  @ApiOperation({ summary: 'Get performance time-series history' })
  @ApiResponse({ status: 200, description: 'Performance history retrieved' })
  async getPerformanceHistory(@Query() query: MetricsQueryDto) {
    const data = this.performanceMetricsService.getPerformanceHistory(query.period || '1h');
    return this.responseService.success(data, 'Performance history retrieved');
  }
}
