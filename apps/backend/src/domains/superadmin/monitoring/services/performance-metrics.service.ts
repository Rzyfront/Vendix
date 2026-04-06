import { Injectable } from '@nestjs/common';
import { PerformanceCollectorService, RequestRecord, MinuteBucket, EventLoopSample } from './performance-collector.service';

interface ResponseTimeStats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

interface SlowEndpoint {
  path: string;
  method: string;
  avgDuration: number;
  p95Duration: number;
  count: number;
}

interface ErrorCounts {
  errors4xx: number;
  errors5xx: number;
  total: number;
}

@Injectable()
export class PerformanceMetricsService {
  constructor(private readonly collector: PerformanceCollectorService) {}

  getPerformanceSnapshot() {
    const buffer = this.collector.getBuffer();
    const minuteBuckets = this.collector.getMinuteBuckets();
    const eventLoopCurrent = this.collector.getCurrentEventLoopStats();
    const eventLoopSamples = this.collector.getEventLoopSamples();

    return {
      responseTime: this.calculateResponseTimeStats(buffer),
      slowestEndpoints: this.getTopSlowEndpoints(buffer, 10),
      throughput: {
        current: this.getCurrentThroughput(minuteBuckets),
        history: minuteBuckets.map(b => ({
          timestamp: new Date(b.timestamp).toISOString(),
          count: b.count,
          totalDuration: b.totalDuration,
          errors4xx: b.errors4xx,
          errors5xx: b.errors5xx,
        })),
      },
      eventLoop: {
        current: eventLoopCurrent,
        samples: eventLoopSamples.map(s => ({
          ...s,
          timestamp: new Date(s.timestamp).toISOString(),
        })),
      },
      errors: {
        last1min: this.getErrorCounts(minuteBuckets, 1),
        last5min: this.getErrorCounts(minuteBuckets, 5),
        last60min: this.getErrorCounts(minuteBuckets, 60),
      },
      activeRequests: this.collector.getActiveRequests(),
      totalRecorded: buffer.length,
    };
  }

  getPerformanceHistory(period: string = '1h') {
    const minuteBuckets = this.collector.getMinuteBuckets();
    const eventLoopSamples = this.collector.getEventLoopSamples();
    const buffer = this.collector.getBuffer();

    const minutes = this.periodToMinutes(period);
    const cutoff = Date.now() - minutes * 60_000;

    const filteredBuckets = minuteBuckets.filter(b => b.timestamp >= cutoff);
    const filteredSamples = eventLoopSamples.filter(s => s.timestamp >= cutoff);
    const filteredRecords = buffer.filter(r => r.timestamp >= cutoff);

    // Group records by minute for response time percentiles
    const recordsByMinute = new Map<number, RequestRecord[]>();
    for (const record of filteredRecords) {
      const minuteKey = Math.floor(record.timestamp / 60_000) * 60_000;
      if (!recordsByMinute.has(minuteKey)) {
        recordsByMinute.set(minuteKey, []);
      }
      recordsByMinute.get(minuteKey)!.push(record);
    }

    const responseTimes = filteredBuckets.map(bucket => {
      const records = recordsByMinute.get(bucket.timestamp) || [];
      const durations = records.map(r => r.duration).sort((a, b) => a - b);
      return {
        timestamp: new Date(bucket.timestamp).toISOString(),
        p50: this.percentile(durations, 50),
        p95: this.percentile(durations, 95),
        p99: this.percentile(durations, 99),
        mean: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      };
    });

    const throughput = filteredBuckets.map(b => ({
      timestamp: new Date(b.timestamp).toISOString(),
      requestsPerSecond: b.count / 60,
    }));

    const errors = filteredBuckets.map(b => ({
      timestamp: new Date(b.timestamp).toISOString(),
      errors4xx: b.errors4xx,
      errors5xx: b.errors5xx,
    }));

    const eventLoopLag = filteredSamples.map(s => ({
      timestamp: new Date(s.timestamp).toISOString(),
      p99: s.p99,
    }));

    return { responseTimes, throughput, errors, eventLoopLag };
  }

  private calculateResponseTimeStats(records: RequestRecord[]): ResponseTimeStats {
    if (records.length === 0) {
      return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
    }

    const durations = records.map(r => r.duration).sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);

    return {
      p50: this.percentile(durations, 50),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99),
      mean: sum / durations.length,
      min: durations[0],
      max: durations[durations.length - 1],
    };
  }

  private getTopSlowEndpoints(records: RequestRecord[], topN: number): SlowEndpoint[] {
    if (records.length === 0) return [];

    // Group by method + path
    const groups = new Map<string, { durations: number[]; method: string; path: string }>();

    for (const record of records) {
      const key = `${record.method} ${record.path}`;
      if (!groups.has(key)) {
        groups.set(key, { durations: [], method: record.method, path: record.path });
      }
      groups.get(key)!.durations.push(record.duration);
    }

    // Calculate avg and p95 per group
    const endpoints: SlowEndpoint[] = [];
    for (const [, group] of groups) {
      const sorted = group.durations.sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      endpoints.push({
        path: group.path,
        method: group.method,
        avgDuration: Math.round(avg * 100) / 100,
        p95Duration: Math.round(this.percentile(sorted, 95) * 100) / 100,
        count: sorted.length,
      });
    }

    // Sort by avgDuration descending, return top N
    return endpoints.sort((a, b) => b.avgDuration - a.avgDuration).slice(0, topN);
  }

  private getCurrentThroughput(buckets: MinuteBucket[]): number {
    if (buckets.length === 0) return 0;
    const lastBucket = buckets[buckets.length - 1];
    // If the last bucket is from the current minute, use it
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    if (lastBucket.timestamp === currentMinute) {
      const elapsedSeconds = (now - currentMinute) / 1000;
      return elapsedSeconds > 0 ? lastBucket.count / elapsedSeconds : 0;
    }
    // Otherwise use the previous complete minute
    return lastBucket.count / 60;
  }

  private getErrorCounts(buckets: MinuteBucket[], minutes: number): ErrorCounts {
    const cutoff = Date.now() - minutes * 60_000;
    let errors4xx = 0;
    let errors5xx = 0;
    let total = 0;

    for (const bucket of buckets) {
      if (bucket.timestamp >= cutoff) {
        errors4xx += bucket.errors4xx;
        errors5xx += bucket.errors5xx;
        total += bucket.count;
      }
    }

    return { errors4xx, errors5xx, total };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private periodToMinutes(period: string): number {
    switch (period) {
      case '15m': return 15;
      case '30m': return 30;
      case '1h': return 60;
      case '6h': return 360;
      case '24h': return 1440;
      default: return 60;
    }
  }
}
