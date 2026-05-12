import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import type Redis from 'ioredis';
import * as v8 from 'v8';
import { CACHE_TTL_APP } from '../constants/cloudwatch.constants';

const BULL_QUEUES = ['ai-generation', 'ai-embedding', 'ai-agent'];

@Injectable()
export class AppMetricsService {
  private readonly logger = new Logger(AppMetricsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getAppMetrics() {
    const cacheKey = 'monitoring:app';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const [heap, queues, processInfo, redisInfo] = await Promise.all([
      this.getHeapMetrics(),
      this.getQueueMetrics(),
      this.getProcessMetrics(),
      this.getRedisInfo(),
    ]);

    const result = { heap, queues, process: processInfo, redis: redisInfo };
    await this.cache.set(cacheKey, result, CACHE_TTL_APP);
    return result;
  }

  private getHeapMetrics() {
    const mem = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    return {
      rss: mem.rss,
      heapTotal: heapStats.heap_size_limit,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    };
  }

  private async getQueueMetrics() {
    const pipeline = this.redis.pipeline();

    for (const name of BULL_QUEUES) {
      pipeline.llen(`bull:${name}:wait`);
      pipeline.llen(`bull:${name}:active`);
      pipeline.zcard(`bull:${name}:completed`);
      pipeline.zcard(`bull:${name}:failed`);
      pipeline.zcard(`bull:${name}:delayed`);
    }

    const results = await pipeline.exec();
    const queues: any[] = [];

    for (let i = 0; i < BULL_QUEUES.length; i++) {
      const offset = i * 5;
      queues.push({
        name: BULL_QUEUES[i],
        waiting: results?.[offset]?.[1] ?? 0,
        active: results?.[offset + 1]?.[1] ?? 0,
        completed: results?.[offset + 2]?.[1] ?? 0,
        failed: results?.[offset + 3]?.[1] ?? 0,
        delayed: results?.[offset + 4]?.[1] ?? 0,
      });
    }

    return queues;
  }

  private getProcessMetrics() {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const uptime = process.uptime();

    return {
      pid: process.pid,
      uptime,
      cpuUser: cpuUsage.user,
      cpuSystem: cpuUsage.system,
      memoryRss: memUsage.rss,
      memoryHeapTotal: heapStats.heap_size_limit,
      memoryHeapUsed: memUsage.heapUsed,
      memoryExternal: memUsage.external,
      memoryArrayBuffers: memUsage.arrayBuffers,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  private async getRedisInfo() {
    try {
      const allInfo = await this.redis.info();

      const parseField = (info: string, field: string): string | null => {
        const match = info.match(new RegExp(`${field}:(.+)`));
        return match ? match[1].trim() : null;
      };

      return {
        usedMemory: parseField(allInfo, 'used_memory_human') || '0B',
        usedMemoryBytes: Number(parseField(allInfo, 'used_memory')) || 0,
        connectedClients: Number(parseField(allInfo, 'connected_clients')) || 0,
        opsPerSec:
          Number(parseField(allInfo, 'instantaneous_ops_per_sec')) || 0,
        totalSystemMemory:
          parseField(allInfo, 'total_system_memory_human') || 'N/A',
        maxMemory: parseField(allInfo, 'maxmemory_human') || 'N/A',
        evictionPolicy: parseField(allInfo, 'maxmemory_policy') || 'N/A',
        keyspaceHits: Number(parseField(allInfo, 'keyspace_hits')) || 0,
        keyspaceMisses: Number(parseField(allInfo, 'keyspace_misses')) || 0,
        uptimeInSeconds: Number(parseField(allInfo, 'uptime_in_seconds')) || 0,
        redisVersion: parseField(allInfo, 'redis_version') || 'N/A',
      };
    } catch (error) {
      this.logger.warn(`Failed to collect Redis info: ${error.message}`);
      return null;
    }
  }
}
