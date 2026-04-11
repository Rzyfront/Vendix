import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CloudWatchService, type MetricQuery } from './cloudwatch.service';
import { MetricsQueryDto } from '../dto/metrics-query.dto';
import {
  autoGranularity,
  CACHE_TTL_INFRASTRUCTURE,
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
export class Ec2MetricsService {
  private readonly logger = new Logger(Ec2MetricsService.name);

  constructor(
    private readonly cloudWatchService: CloudWatchService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getDetailedMetrics(query: MetricsQueryDto) {
    const period = query.period || '1h';
    const granularity = query.granularity || autoGranularity(period);
    const cacheKey = `monitoring:ec2:${period}:${granularity}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const startTime = periodToStartTime(period);
    const endTime = new Date();
    const periodSeconds = periodToSeconds(granularity);

    const dimensions = [{ Name: 'InstanceId', Value: this.cloudWatchService.ec2InstanceId }];
    const namespace = 'AWS/EC2';

    const queries: MetricQuery[] = [
      { id: 'cpu_utilization', metricName: 'CPUUtilization', namespace, dimensions },
      { id: 'cpu_credit_balance', metricName: 'CPUCreditBalance', namespace, dimensions },
      { id: 'cpu_credit_usage', metricName: 'CPUCreditUsage', namespace, dimensions },
      { id: 'network_in', metricName: 'NetworkIn', namespace, dimensions },
      { id: 'network_out', metricName: 'NetworkOut', namespace, dimensions },
      { id: 'disk_read_ops', metricName: 'EBSReadOps', namespace, dimensions },
      { id: 'disk_write_ops', metricName: 'EBSWriteOps', namespace, dimensions },
      { id: 'disk_read_bytes', metricName: 'EBSReadBytes', namespace, dimensions },
      { id: 'disk_write_bytes', metricName: 'EBSWriteBytes', namespace, dimensions },
      { id: 'status_check_failed', metricName: 'StatusCheckFailed', namespace, dimensions },
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
        creditBalance: toSeries('cpu_credit_balance', 'Count'),
        creditUsage: toSeries('cpu_credit_usage', 'Count'),
      },
      network: {
        bytesIn: toSeries('network_in', 'Bytes'),
        bytesOut: toSeries('network_out', 'Bytes'),
      },
      disk: {
        readOps: toSeries('disk_read_ops', 'Count'),
        writeOps: toSeries('disk_write_ops', 'Count'),
        readBytes: toSeries('disk_read_bytes', 'Bytes'),
        writeBytes: toSeries('disk_write_bytes', 'Bytes'),
      },
      status: {
        checkFailed: toSeries('status_check_failed', 'Count'),
      },
    };

    await this.cache.set(cacheKey, result, CACHE_TTL_INFRASTRUCTURE);

    return result;
  }
}
