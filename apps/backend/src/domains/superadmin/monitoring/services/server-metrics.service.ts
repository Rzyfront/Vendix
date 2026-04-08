import { Injectable, Logger } from '@nestjs/common';
import { statfsSync } from 'fs';
import * as os from 'os';
import { VendixHttpException } from '../../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../../common/errors/error-codes';

@Injectable()
export class ServerMetricsService {
  private readonly logger = new Logger(ServerMetricsService.name);

  getServerInfo() {
    try {
      const cpus = os.cpus();

      return {
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
