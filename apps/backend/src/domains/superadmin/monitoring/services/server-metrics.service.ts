import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
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

  private getDiskInfo(): any | null {
    try {
      const output = execSync('df -h / | tail -1', {
        timeout: 5000,
        encoding: 'utf-8',
      });

      const parts = output.trim().split(/\s+/);
      if (parts.length >= 6) {
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parts[4],
          mountedOn: parts[5],
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to collect disk info: ${error.message}`);
      return null;
    }
  }
}
