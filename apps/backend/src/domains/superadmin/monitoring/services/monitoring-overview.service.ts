import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CloudWatchService } from './cloudwatch.service';
import { ServerMetricsService } from './server-metrics.service';
import {
  EC2_INSTANCE_ID,
  RDS_DB_IDENTIFIER,
} from '../constants/cloudwatch.constants';

@Injectable()
export class MonitoringOverviewService {
  private readonly logger = new Logger(MonitoringOverviewService.name);

  constructor(
    private readonly cloudWatchService: CloudWatchService,
    private readonly serverMetricsService: ServerMetricsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getOverview() {
    const cacheKey = 'monitoring:overview';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const startTime = new Date(now.getTime() - 10 * 60 * 1000); // last 10 min
    const period = 300; // 5 min granularity

    const [ec2Results, rdsResults, serverInfo] = await Promise.all([
      this.cloudWatchService.getMultipleMetrics(
        [
          {
            id: 'ec2_cpu',
            metricName: 'CPUUtilization',
            namespace: 'AWS/EC2',
            dimensions: [{ Name: 'InstanceId', Value: EC2_INSTANCE_ID }],
          },
          {
            id: 'ec2_status',
            metricName: 'StatusCheckFailed',
            namespace: 'AWS/EC2',
            dimensions: [{ Name: 'InstanceId', Value: EC2_INSTANCE_ID }],
          },
        ],
        startTime,
        now,
        period,
      ),
      this.cloudWatchService.getMultipleMetrics(
        [
          {
            id: 'rds_cpu',
            metricName: 'CPUUtilization',
            namespace: 'AWS/RDS',
            dimensions: [
              { Name: 'DBInstanceIdentifier', Value: RDS_DB_IDENTIFIER },
            ],
          },
          {
            id: 'rds_connections',
            metricName: 'DatabaseConnections',
            namespace: 'AWS/RDS',
            dimensions: [
              { Name: 'DBInstanceIdentifier', Value: RDS_DB_IDENTIFIER },
            ],
          },
          {
            id: 'rds_storage',
            metricName: 'FreeStorageSpace',
            namespace: 'AWS/RDS',
            dimensions: [
              { Name: 'DBInstanceIdentifier', Value: RDS_DB_IDENTIFIER },
            ],
          },
          {
            id: 'rds_memory',
            metricName: 'FreeableMemory',
            namespace: 'AWS/RDS',
            dimensions: [
              { Name: 'DBInstanceIdentifier', Value: RDS_DB_IDENTIFIER },
            ],
          },
        ],
        startTime,
        now,
        period,
      ),
      Promise.resolve(this.serverMetricsService.getServerInfo()),
    ]);

    const getLatest = (
      results: Map<string, { timestamps: string[]; values: number[] }>,
      id: string,
    ): number => {
      const data = results.get(id);
      if (!data || data.values.length === 0) return 0;
      return data.values[data.values.length - 1];
    };

    const ec2Cpu = getLatest(ec2Results, 'ec2_cpu');
    const ec2StatusFailed = getLatest(ec2Results, 'ec2_status');

    const determineStatus = (
      cpu: number,
      statusFailed: number,
    ): 'healthy' | 'warning' | 'critical' => {
      if (statusFailed > 0 || cpu > 90) return 'critical';
      if (cpu > 70) return 'warning';
      return 'healthy';
    };

    const result = {
      ec2: {
        cpuUtilization: ec2Cpu,
        status: determineStatus(ec2Cpu, ec2StatusFailed),
      },
      rds: {
        cpuUtilization: getLatest(rdsResults, 'rds_cpu'),
        connections: getLatest(rdsResults, 'rds_connections'),
        freeStorageGB:
          getLatest(rdsResults, 'rds_storage') / (1024 * 1024 * 1024),
        freeMemoryMB: getLatest(rdsResults, 'rds_memory') / (1024 * 1024),
      },
      server: {
        uptime: serverInfo.uptime,
        memoryUsedPercent:
          ((serverInfo.totalMemory - serverInfo.freeMemory) /
            serverInfo.totalMemory) *
          100,
        loadAverage: serverInfo.loadAverage,
        disk: serverInfo.disk,
      },
      timestamp: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, result, 60000);

    return result;
  }
}
