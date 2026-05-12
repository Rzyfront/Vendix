import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CloudWatchService } from './cloudwatch.service';
import { ServerMetricsService } from './server-metrics.service';
import { CACHE_TTL_OVERVIEW } from '../constants/cloudwatch.constants';

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

    const [allResults, serverInfo] = await Promise.all([
      this.cloudWatchService.getMultipleMetrics(
        [
          // EC2 metrics
          {
            id: 'ec2_cpu',
            metricName: 'CPUUtilization',
            namespace: 'AWS/EC2',
            dimensions: [
              {
                Name: 'InstanceId',
                Value: this.cloudWatchService.ec2InstanceId,
              },
            ],
          },
          {
            id: 'ec2_status',
            metricName: 'StatusCheckFailed',
            namespace: 'AWS/EC2',
            dimensions: [
              {
                Name: 'InstanceId',
                Value: this.cloudWatchService.ec2InstanceId,
              },
            ],
          },
          // RDS metrics
          {
            id: 'rds_cpu',
            metricName: 'CPUUtilization',
            namespace: 'AWS/RDS',
            dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: this.cloudWatchService.rdsDbIdentifier,
              },
            ],
          },
          {
            id: 'rds_connections',
            metricName: 'DatabaseConnections',
            namespace: 'AWS/RDS',
            dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: this.cloudWatchService.rdsDbIdentifier,
              },
            ],
          },
          {
            id: 'rds_storage',
            metricName: 'FreeStorageSpace',
            namespace: 'AWS/RDS',
            dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: this.cloudWatchService.rdsDbIdentifier,
              },
            ],
          },
          {
            id: 'rds_memory',
            metricName: 'FreeableMemory',
            namespace: 'AWS/RDS',
            dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: this.cloudWatchService.rdsDbIdentifier,
              },
            ],
          },
        ],
        startTime,
        now,
        period,
      ),
      this.serverMetricsService.getServerInfo(),
    ]);

    const getLatest = (
      results: Map<string, { timestamps: string[]; values: number[] }>,
      id: string,
    ): number => {
      const data = results.get(id);
      if (!data || data.values.length === 0) return 0;
      return data.values[data.values.length - 1];
    };

    const ec2Cpu = getLatest(allResults, 'ec2_cpu');
    const ec2StatusFailed = getLatest(allResults, 'ec2_status');

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
        cpuUtilization: getLatest(allResults, 'rds_cpu'),
        connections: getLatest(allResults, 'rds_connections'),
        freeStorageGB:
          getLatest(allResults, 'rds_storage') / (1024 * 1024 * 1024),
        freeMemoryMB: getLatest(allResults, 'rds_memory') / (1024 * 1024),
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

    await this.cache.set(cacheKey, result, CACHE_TTL_OVERVIEW);

    return result;
  }
}
