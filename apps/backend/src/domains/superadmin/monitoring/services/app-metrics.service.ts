import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import type Redis from 'ioredis';

const BULL_QUEUES = ['ai-generation', 'ai-embedding', 'ai-agent'];

@Injectable()
export class AppMetricsService {
  private readonly logger = new Logger(AppMetricsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getAppMetrics() {
    const [heap, queues, processInfo, redisInfo] = await Promise.all([
      this.getHeapMetrics(),
      this.getQueueMetrics(),
      this.getProcessMetrics(),
      this.getRedisInfo(),
    ]);

    return { heap, queues, process: processInfo, redis: redisInfo };
  }

  private getHeapMetrics() {
    const mem = process.memoryUsage();
    return {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
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
    const uptime = process.uptime();

    return {
      pid: process.pid,
      uptime,
      cpuUser: cpuUsage.user,
      cpuSystem: cpuUsage.system,
      memoryRss: memUsage.rss,
      memoryHeapTotal: memUsage.heapTotal,
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
      const [memoryInfo, statsInfo, clientsInfo, serverInfo] = await Promise.all([
        this.redis.info('memory'),
        this.redis.info('stats'),
        this.redis.info('clients'),
        this.redis.info('server'),
      ]);

      const parseField = (info: string, field: string): string | null => {
        const match = info.match(new RegExp(`${field}:(.+)`));
        return match ? match[1].trim() : null;
      };

      return {
        usedMemory: parseField(memoryInfo, 'used_memory_human') || '0B',
        usedMemoryBytes: Number(parseField(memoryInfo, 'used_memory')) || 0,
        connectedClients: Number(parseField(clientsInfo, 'connected_clients')) || 0,
        opsPerSec: Number(parseField(statsInfo, 'instantaneous_ops_per_sec')) || 0,
        totalSystemMemory: parseField(memoryInfo, 'total_system_memory_human') || 'N/A',
        maxMemory: parseField(memoryInfo, 'maxmemory_human') || 'N/A',
        evictionPolicy: parseField(memoryInfo, 'maxmemory_policy') || 'N/A',
        keyspaceHits: Number(parseField(statsInfo, 'keyspace_hits')) || 0,
        keyspaceMisses: Number(parseField(statsInfo, 'keyspace_misses')) || 0,
        uptimeInSeconds: Number(parseField(statsInfo, 'uptime_in_seconds')) || 0,
        redisVersion: parseField(serverInfo, 'redis_version') || 'N/A',
      };
    } catch (error) {
      this.logger.warn(`Failed to collect Redis info: ${error.message}`);
      return null;
    }
  }
}
