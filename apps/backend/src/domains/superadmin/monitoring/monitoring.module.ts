import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { PlatformAlertsController } from './platform-alerts.controller';
import { PlatformAlertsAdminService } from './services/platform-alerts-admin.service';
import { CloudWatchService } from './services/cloudwatch.service';
import { Ec2MetricsService } from './services/ec2-metrics.service';
import { RdsMetricsService } from './services/rds-metrics.service';
import { AppMetricsService } from './services/app-metrics.service';
import { ServerMetricsService } from './services/server-metrics.service';
import { MonitoringOverviewService } from './services/monitoring-overview.service';
import { ResponseService } from '../../../common/responses/response.service';
import { PerformanceMetricsService } from './services/performance-metrics.service';

@Module({
  controllers: [MonitoringController, PlatformAlertsController],
  providers: [
    CloudWatchService,
    Ec2MetricsService,
    RdsMetricsService,
    AppMetricsService,
    ServerMetricsService,
    MonitoringOverviewService,
    PerformanceMetricsService,
    PlatformAlertsAdminService,
    ResponseService,
  ],
})
export class MonitoringModule {}
