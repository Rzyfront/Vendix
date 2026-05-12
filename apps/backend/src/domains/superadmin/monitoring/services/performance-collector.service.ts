import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';

export interface RequestRecord {
  method: string;
  path: string;
  statusCode: number;
  duration: number; // ms
  timestamp: number; // Date.now()
}

export interface MinuteBucket {
  timestamp: number; // minute-aligned epoch ms
  count: number;
  totalDuration: number;
  errors4xx: number;
  errors5xx: number;
  minDuration: number;
  maxDuration: number;
}

export interface EventLoopSample {
  timestamp: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

const BUFFER_SIZE = 5000;
const MAX_MINUTE_BUCKETS = 60; // 1 hour of history
const EVENT_LOOP_SAMPLE_INTERVAL = 10_000; // 10 seconds
const MAX_EVENT_LOOP_SAMPLES = 360; // 1 hour at 10s intervals
const EVICTION_CHECK_INTERVAL = 60; // check every 60 records

@Injectable()
export class PerformanceCollectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PerformanceCollectorService.name);

  // Circular buffer for request records
  private buffer: (RequestRecord | null)[] = new Array(BUFFER_SIZE).fill(null);
  private bufferIndex = 0;
  private bufferCount = 0; // total records written (may exceed BUFFER_SIZE)

  // Minute buckets for time-series aggregation
  private minuteBuckets = new Map<number, MinuteBucket>();
  private recordsSinceEviction = 0;

  // Active requests counter
  private activeRequests = 0;

  // Event loop monitoring
  private histogram: IntervalHistogram | null = null;
  private eventLoopSamples: EventLoopSample[] = [];
  private samplingInterval: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 10 });
      this.histogram.enable();

      this.samplingInterval = setInterval(() => {
        this.sampleEventLoop();
      }, EVENT_LOOP_SAMPLE_INTERVAL);

      this.logger.log(
        'Performance collector initialized with event loop monitoring',
      );
    } catch (error) {
      this.logger.warn(`Event loop monitoring not available: ${error.message}`);
    }
  }

  onModuleDestroy(): void {
    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
    if (this.histogram) {
      this.histogram.disable();
      this.histogram = null;
    }
  }

  /**
   * Record a request. O(1) operation — writes to circular buffer and updates minute bucket.
   */
  record(entry: Omit<RequestRecord, 'timestamp'>): void {
    const timestamp = Date.now();
    const record: RequestRecord = { ...entry, timestamp };

    // Write to circular buffer
    this.buffer[this.bufferIndex] = record;
    this.bufferIndex = (this.bufferIndex + 1) % BUFFER_SIZE;
    this.bufferCount++;

    // Update minute bucket
    const minuteKey = Math.floor(timestamp / 60_000) * 60_000;
    let bucket = this.minuteBuckets.get(minuteKey);
    if (!bucket) {
      bucket = {
        timestamp: minuteKey,
        count: 0,
        totalDuration: 0,
        errors4xx: 0,
        errors5xx: 0,
        minDuration: Infinity,
        maxDuration: 0,
      };
      this.minuteBuckets.set(minuteKey, bucket);
    }

    bucket.count++;
    bucket.totalDuration += entry.duration;
    if (entry.duration < bucket.minDuration)
      bucket.minDuration = entry.duration;
    if (entry.duration > bucket.maxDuration)
      bucket.maxDuration = entry.duration;
    if (entry.statusCode >= 400 && entry.statusCode < 500) bucket.errors4xx++;
    if (entry.statusCode >= 500) bucket.errors5xx++;

    // Lazy eviction of old minute buckets
    this.recordsSinceEviction++;
    if (this.recordsSinceEviction >= EVICTION_CHECK_INTERVAL) {
      this.recordsSinceEviction = 0;
      const cutoff = Date.now() - MAX_MINUTE_BUCKETS * 60_000;
      for (const [key] of this.minuteBuckets) {
        if (key < cutoff) this.minuteBuckets.delete(key);
      }
    }
  }

  trackActiveRequest(delta: 1 | -1): void {
    this.activeRequests += delta;
  }

  /**
   * Get all valid records from the circular buffer, ordered oldest to newest.
   */
  getBuffer(): RequestRecord[] {
    const records: RequestRecord[] = [];
    const total = Math.min(this.bufferCount, BUFFER_SIZE);

    if (total === 0) return records;

    if (this.bufferCount <= BUFFER_SIZE) {
      // Buffer hasn't wrapped yet
      for (let i = 0; i < total; i++) {
        if (this.buffer[i]) records.push(this.buffer[i]!);
      }
    } else {
      // Buffer has wrapped — read from bufferIndex (oldest) to end, then from 0 to bufferIndex-1
      for (let i = 0; i < BUFFER_SIZE; i++) {
        const idx = (this.bufferIndex + i) % BUFFER_SIZE;
        if (this.buffer[idx]) records.push(this.buffer[idx]);
      }
    }

    return records;
  }

  /**
   * Get minute buckets sorted by timestamp.
   */
  getMinuteBuckets(): MinuteBucket[] {
    return Array.from(this.minuteBuckets.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  getActiveRequests(): number {
    return this.activeRequests;
  }

  getEventLoopSamples(): EventLoopSample[] {
    return [...this.eventLoopSamples];
  }

  getCurrentEventLoopStats(): EventLoopSample | null {
    if (!this.histogram) return null;

    return {
      timestamp: Date.now(),
      min: this.histogram.min / 1_000_000, // ns to ms
      max: this.histogram.max / 1_000_000,
      mean: this.histogram.mean / 1_000_000,
      p50: this.histogram.percentile(50) / 1_000_000,
      p95: this.histogram.percentile(95) / 1_000_000,
      p99: this.histogram.percentile(99) / 1_000_000,
    };
  }

  private sampleEventLoop(): void {
    if (!this.histogram) return;

    const sample: EventLoopSample = {
      timestamp: Date.now(),
      min: this.histogram.min / 1_000_000,
      max: this.histogram.max / 1_000_000,
      mean: this.histogram.mean / 1_000_000,
      p50: this.histogram.percentile(50) / 1_000_000,
      p95: this.histogram.percentile(95) / 1_000_000,
      p99: this.histogram.percentile(99) / 1_000_000,
    };

    this.eventLoopSamples.push(sample);
    if (this.eventLoopSamples.length > MAX_EVENT_LOOP_SAMPLES) {
      this.eventLoopSamples.shift();
    }

    // Reset histogram for next interval
    this.histogram.reset();
  }
}
