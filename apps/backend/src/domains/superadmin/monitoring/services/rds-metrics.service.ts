import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CloudWatchService, type MetricQuery } from './cloudwatch.service';
import { MetricsQueryDto } from '../dto/metrics-query.dto';
import {
  autoGranularity,
  MONITORING_CACHE_TTL,
  periodToSeconds,
  periodToStartTime,
} from '../constants/cloudwatch.constants';

interface MetricDatapoint {
  timestamp: string;
  value: number;
}

interface MetricSeries {
  datapoints: MetricDatapoint[];
  latest: number;
  unit: string;
}

@Injectable()
export class RdsMetricsService {
  private readonly logger = new Logger(RdsMetricsService.name);

  constructor(
    private readonly cloudWatchService: CloudWatchService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getDetailedMetrics(query: MetricsQueryDto) {
    const period = query.period || '1h';
    const granularity = query.granularity || autoGranularity(period);
    const cacheKey = `monitoring:rds:${period}:${granularity}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const startTime = periodToStartTime(period);
    const endTime = new Date();
    const periodSeconds = periodToSeconds(granularity);

    const dimensions = [
      { Name: 'DBInstanceIdentifier', Value: this.cloudWatchService.rdsDbIdentifier },
    ];
    const namespace = 'AWS/RDS';

    const queries: MetricQuery[] = [
      { id: 'cpu_utilization', metricName: 'CPUUtilization', namespace, dimensions },
      { id: 'database_connections', metricName: 'DatabaseConnections', namespace, dimensions },
      { id: 'free_storage_space', metricName: 'FreeStorageSpace', namespace, dimensions },
      { id: 'freeable_memory', metricName: 'FreeableMemory', namespace, dimensions },
      { id: 'read_iops', metricName: 'ReadIOPS', namespace, dimensions },
      { id: 'write_iops', metricName: 'WriteIOPS', namespace, dimensions },
      { id: 'read_latency', metricName: 'ReadLatency', namespace, dimensions },
      { id: 'write_latency', metricName: 'WriteLatency', namespace, dimensions },
    ];

    const resultsMap = await this.cloudWatchService.getMultipleMetrics(
      queries,
      startTime,
      endTime,
      periodSeconds,
    );

    const toSeries = (id: string, unit: string): MetricSeries => {
      const data = resultsMap.get(id);
      if (!data || data.timestamps.length === 0) {
        return { datapoints: [], latest: 0, unit };
      }

      const datapoints: MetricDatapoint[] = data.timestamps
        .map((timestamp, i) => ({ timestamp, value: data.values[i] }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      return {
        datapoints,
        latest: datapoints[datapoints.length - 1]?.value ?? 0,
        unit,
      };
    };

    const result = {
      cpu: {
        utilization: toSeries('cpu_utilization', 'Percent'),
      },
      connections: {
        active: toSeries('database_connections', 'Count'),
      },
      storage: {
        freeStorageSpace: toSeries('free_storage_space', 'Bytes'),
        freeableMemory: toSeries('freeable_memory', 'Bytes'),
      },
      iops: {
        readIOPS: toSeries('read_iops', 'Count/Second'),
        writeIOPS: toSeries('write_iops', 'Count/Second'),
      },
      latency: {
        readLatency: toSeries('read_latency', 'Seconds'),
        writeLatency: toSeries('write_latency', 'Seconds'),
      },
    };

    await this.cache.set(cacheKey, result, MONITORING_CACHE_TTL);

    return result;
  }
}
