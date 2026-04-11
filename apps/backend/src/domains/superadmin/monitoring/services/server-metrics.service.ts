import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { statfsSync } from 'fs';
import * as os from 'os';
import { VendixHttpException } from '../../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../../common/errors/error-codes';
import { CACHE_TTL_SERVER } from '../constants/cloudwatch.constants';

export interface ServerInfoResult {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  processUptime: number;
  loadAverage: number[];
  totalMemory: number;
  freeMemory: number;
  cpuCount: number;
  cpuModel: string;
  nodeVersion: string;
  pid: number;
  disk: any | null;
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
}

@Injectable()
export class ServerMetricsService {
  private readonly logger = new Logger(ServerMetricsService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async getServerInfo(): Promise<ServerInfoResult> {
    const cacheKey = 'monitoring:server';
    const cached = await this.cache.get<ServerInfoResult>(cacheKey);
    if (cached) return cached;

    try {
      const cpus = os.cpus();

      const result = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptime: os.uptime(),
        processUptime: process.uptime(),
        loadAverage: os.loadavg(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuCount: cpus.length,
        cpuModel: cpus[0]?.model || 'Unknown',
        nodeVersion: process.version,
        pid: process.pid,
        disk: this.getDiskInfo(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem(),
          usedPercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
        },
      };

      await this.cache.set(cacheKey, result, CACHE_TTL_SERVER);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to collect server metrics: ${error.message}`,
        error.stack,
      );
      throw new VendixHttpException(
        ErrorCodes.MON_METRICS_001,
        `Server metrics collection failed: ${error.message}`,
      );
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0B';
    const units = ['B', 'K', 'M', 'G', 'T', 'P'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return value >= 10
      ? `${Math.round(value)}${units[i]}`
      : `${value.toFixed(1)}${units[i]}`;
  }

  private getDiskInfo(): any | null {
    try {
      const stats = statfsSync('/');
      const total = stats.bsize * stats.blocks;
      const available = stats.bsize * stats.bavail;
      const used = total - available;
      const usePercent =
        total > 0 ? ((used / total) * 100).toFixed(0) + '%' : '0%';

      return {
        filesystem: '/',
        size: this.formatBytes(total),
        used: this.formatBytes(used),
        available: this.formatBytes(available),
        usePercent,
        mountedOn: '/',
      };
    } catch (error) {
      this.logger.warn(`Failed to collect disk info: ${error.message}`);
      return null;
    }
  }
}
