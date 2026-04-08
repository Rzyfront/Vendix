import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, timer } from 'rxjs';
import { takeUntil, map, catchError, filter } from 'rxjs/operators';
import { of } from 'rxjs';
import { StatsComponent } from '../../../../shared/components';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { formatBytes as _formatBytes } from '../../../../core/utils/format.utils';
import { MonitoringService } from './services';
import {
  MetricChartComponent,
  TimeRangeSelectorComponent,
  StatusIndicatorComponent,
  ProcessInfoComponent,
  QueueStatsComponent,
  SlowEndpointsComponent,
} from './components';
import {
  MonitoringOverview,
  Ec2MetricsResponse,
  RdsMetricsResponse,
  AppMetrics,
  ServerInfo,
  TimeRange,
  MetricStatus,
  PerformanceSnapshot,
  PerformanceHistory,
  TimeSeriesPoint,
} from './interfaces';

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    IconComponent,
    MetricChartComponent,
    TimeRangeSelectorComponent,
    StatusIndicatorComponent,
    ProcessInfoComponent,
    QueueStatsComponent,
    SlowEndpointsComponent,
  ],
  providers: [MonitoringService],
  template: `
    <div style="background-color: var(--color-background);" class="space-y-6">
      <!-- Stats Cards -->
      <div class="stats-container">
        <app-stats
          title="EC2 CPU"
          [value]="ec2CpuValue"
          [smallText]="ec2CpuSmall"
          iconName="cpu"
          [iconBgColor]="ec2CpuBg"
          [iconColor]="ec2CpuColor"
          [loading]="loadingOverview"
        ></app-stats>
        <app-stats
          title="RDS CPU"
          [value]="rdsCpuValue"
          [smallText]="rdsConnectionsSmall"
          iconName="database"
          [iconBgColor]="rdsCpuBg"
          [iconColor]="rdsCpuColor"
          [loading]="loadingOverview"
        ></app-stats>
        <app-stats
          title="Memoria"
          [value]="memoryValue"
          [smallText]="memorySmall"
          iconName="memory-stick"
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
          [loading]="loadingOverview"
        ></app-stats>
        <app-stats
          title="Disco"
          [value]="diskValue"
          [smallText]="diskSmall"
          iconName="hard-drive"
          iconBgColor="bg-purple-500/10"
          iconColor="text-purple-500"
          [loading]="loadingOverview"
        ></app-stats>
      </div>

      <!-- Status bar -->
      <div
        class="rounded-card shadow-card p-4 flex items-center justify-between flex-wrap gap-3"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div class="flex items-center gap-4">
          <app-status-indicator
            [status]="overallStatus"
            [label]="overallStatusLabel"
          ></app-status-indicator>
          <span class="text-sm" style="color: var(--color-text-secondary);">
            <app-icon name="clock" [size]="14" style="display: inline; vertical-align: middle; margin-right: 4px; color: var(--color-text-muted);"></app-icon>
            Uptime: <strong style="color: var(--color-text-primary);">{{ formatUptime(overview?.server?.uptime) }}</strong>
          </span>
        </div>
        <span class="text-xs font-mono px-2 py-1 rounded-full" style="background: var(--color-background); color: var(--color-text-muted);">
          Auto-refresh: 30s
        </span>
      </div>

      <!-- EC2 Metrics Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex justify-between items-center p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(249,115,22,0.05) 0%, transparent 100%);"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-500/10">
              <app-icon name="server" [size]="16" class="text-orange-500"></app-icon>
            </div>
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Metricas EC2
            </h3>
          </div>
          <app-time-range-selector
            [selected]="ec2TimeRange"
            (rangeChange)="onEc2TimeRangeChange($event)"
          ></app-time-range-selector>
        </div>
        <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <app-metric-chart
            label="CPU Utilization"
            [datapoints]="ec2Metrics?.cpu?.utilization?.datapoints"
            unit="%"
            color="#f97316"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Network I/O"
            [datapoints]="ec2Metrics?.network?.bytesIn?.datapoints"
            unit="bytes"
            color="#3b82f6"
            [secondaryDatapoints]="ec2Metrics?.network?.bytesOut?.datapoints"
            secondaryLabel="Out"
            secondaryColor="#ef4444"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Disk Read"
            [datapoints]="ec2Metrics?.disk?.readBytes?.datapoints"
            unit="bytes"
            color="#8b5cf6"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Disk Write"
            [datapoints]="ec2Metrics?.disk?.writeBytes?.datapoints"
            unit="bytes"
            color="#ec4899"
            [loading]="loadingEc2"
          ></app-metric-chart>
        </div>
      </div>

      <!-- RDS Metrics Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex justify-between items-center p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(16,185,129,0.05) 0%, transparent 100%);"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10">
              <app-icon name="database" [size]="16" class="text-emerald-500"></app-icon>
            </div>
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Metricas RDS (PostgreSQL)
            </h3>
          </div>
          <app-time-range-selector
            [selected]="rdsTimeRange"
            (rangeChange)="onRdsTimeRangeChange($event)"
          ></app-time-range-selector>
        </div>
        <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <app-metric-chart
            label="CPU Utilization"
            [datapoints]="rdsMetrics?.cpu?.utilization?.datapoints"
            unit="%"
            color="#10b981"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="Conexiones Activas"
            [datapoints]="rdsMetrics?.connections?.active?.datapoints"
            unit=""
            color="#6366f1"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="IOPS (Read/Write)"
            [datapoints]="rdsMetrics?.iops?.read?.datapoints"
            unit="ops"
            color="#3b82f6"
            [secondaryDatapoints]="rdsMetrics?.iops?.write?.datapoints"
            secondaryLabel="Write"
            secondaryColor="#f97316"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="Latencia (Read/Write)"
            [datapoints]="rdsMetrics?.latency?.read?.datapoints"
            unit="ms"
            color="#14b8a6"
            [secondaryDatapoints]="rdsMetrics?.latency?.write?.datapoints"
            secondaryLabel="Write"
            secondaryColor="#f43f5e"
            [loading]="loadingRds"
          ></app-metric-chart>
        </div>
      </div>

      <!-- Performance Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex justify-between items-center p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(168,85,247,0.05) 0%, transparent 100%);"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/10">
              <app-icon name="zap" [size]="16" class="text-purple-500"></app-icon>
            </div>
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Performance
            </h3>
            <span *ngIf="performanceSnapshot" class="text-xs font-mono px-2 py-0.5 rounded-full" style="background: var(--color-background); color: var(--color-text-muted);">
              {{ performanceSnapshot.totalRecorded }} requests tracked
            </span>
          </div>
          <app-time-range-selector
            [selected]="performanceTimeRange"
            (rangeChange)="onPerformanceTimeRangeChange($event)"
          ></app-time-range-selector>
        </div>

        <div class="p-6 space-y-6">
          <!-- Performance Stats Cards -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 rounded-xl text-center" style="background: var(--color-background); border: 1px solid var(--color-border);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Avg Response</p>
              <p class="text-xl font-bold font-mono" [class]="avgResponseTimeColor">{{ avgResponseTime }}</p>
              <p class="text-[10px]" style="color: var(--color-text-muted);" *ngIf="performanceSnapshot">
                p95: {{ performanceSnapshot.responseTime.p95.toFixed(0) }}ms
              </p>
            </div>
            <div class="p-3 rounded-xl text-center" style="background: var(--color-background); border: 1px solid var(--color-border);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Requests/seg</p>
              <p class="text-xl font-bold font-mono text-blue-500">{{ reqPerSec }}</p>
              <p class="text-[10px]" style="color: var(--color-text-muted);" *ngIf="performanceSnapshot">
                {{ performanceSnapshot.activeRequests }} activos
              </p>
            </div>
            <div class="p-3 rounded-xl text-center" style="background: var(--color-background); border: 1px solid var(--color-border);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Error Rate (5m)</p>
              <p class="text-xl font-bold font-mono" [class]="errorRateColor">{{ errorRate }}</p>
              <p class="text-[10px]" style="color: var(--color-text-muted);" *ngIf="performanceSnapshot">
                {{ performanceSnapshot.errors.last5min.errors5xx }} errores 5xx
              </p>
            </div>
            <div class="p-3 rounded-xl text-center" style="background: var(--color-background); border: 1px solid var(--color-border);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Event Loop p99</p>
              <p class="text-xl font-bold font-mono" [class]="eventLoopColor">{{ eventLoopP99 }}</p>
              <p class="text-[10px]" style="color: var(--color-text-muted);" *ngIf="performanceSnapshot?.eventLoop?.current">
                mean: {{ performanceSnapshot!.eventLoop!.current!.mean.toFixed(1) }}ms
              </p>
            </div>
          </div>

          <!-- Charts Grid -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <app-metric-chart
              label="Response Time (ms)"
              [datapoints]="rtP50Points"
              unit="ms"
              color="#22c55e"
              [secondaryDatapoints]="rtP95Points"
              secondaryLabel="p95"
              secondaryColor="#eab308"
              [tertiaryDatapoints]="rtP99Points"
              tertiaryLabel="p99"
              tertiaryColor="#ef4444"
              [loading]="loadingPerformance"
            ></app-metric-chart>
            <app-metric-chart
              label="Throughput (req/s)"
              [datapoints]="throughputPoints"
              unit=""
              color="#3b82f6"
              [loading]="loadingPerformance"
            ></app-metric-chart>
          </div>

          <!-- Slow Endpoints -->
          <app-slow-endpoints
            [endpoints]="performanceSnapshot?.slowestEndpoints ?? null"
            [loading]="loadingPerformance"
          ></app-slow-endpoints>

          <!-- More Charts -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <app-metric-chart
              label="Errores por minuto"
              [datapoints]="errors4xxPoints"
              unit=""
              color="#eab308"
              [secondaryDatapoints]="errors5xxPoints"
              secondaryLabel="5xx"
              secondaryColor="#ef4444"
              [loading]="loadingPerformance"
            ></app-metric-chart>
            <app-metric-chart
              label="Event Loop Lag p99 (ms)"
              [datapoints]="eventLoopLagPoints"
              unit="ms"
              color="#a855f7"
              [loading]="loadingPerformance"
            ></app-metric-chart>
          </div>
        </div>
      </div>

      <!-- Application Health Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex items-center gap-3 p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(6,182,212,0.05) 0%, transparent 100%);"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/10">
            <app-icon name="heart-pulse" [size]="16" class="text-cyan-500"></app-icon>
          </div>
          <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
            Salud de la Aplicacion
          </h3>
        </div>
        <div class="p-6 space-y-4">
          <!-- Server Memory Overview -->
          <div *ngIf="serverInfo?.memory" class="rounded-xl p-4" style="background: var(--color-background); border: 1px solid var(--color-border);">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-5 h-5 rounded flex items-center justify-center bg-blue-500/10">
                <app-icon name="memory-stick" [size]="12" class="text-blue-500"></app-icon>
              </span>
              <h4 class="text-sm font-semibold" style="color: var(--color-text-primary);">Memoria del Servidor</h4>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Total</p>
                <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.total) }}</p>
              </div>
              <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Usado</p>
                <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.used) }}</p>
              </div>
              <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Libre</p>
                <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.free) }}</p>
              </div>
              <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Uso</p>
                <p class="font-mono text-sm font-bold" [style.color]="serverInfo!.memory.usedPercent > 80 ? '#ef4444' : serverInfo!.memory.usedPercent > 60 ? '#eab308' : '#22c55e'">{{ serverInfo!.memory.usedPercent.toFixed(1) }}%</p>
              </div>
            </div>
            <div class="w-full h-2.5 rounded-full overflow-hidden" style="background: var(--color-border);">
              <div class="h-full rounded-full transition-all duration-500"
                [style.width.%]="serverInfo!.memory.usedPercent"
                [style.background]="serverInfo!.memory.usedPercent > 80 ? '#ef4444' : serverInfo!.memory.usedPercent > 60 ? '#eab308' : '#22c55e'">
              </div>
            </div>
          </div>

          <!-- Process Info -->
          <app-process-info
            [info]="appMetrics?.process ?? null"
            [loading]="loadingApp"
          ></app-process-info>

          <!-- Queue Stats -->
          <app-queue-stats
            [queues]="appMetrics?.queues"
            [loading]="loadingApp"
          ></app-queue-stats>

          <!-- Redis Info - Redesigned -->
          <div *ngIf="appMetrics?.redis"
            class="rounded-xl overflow-hidden"
            style="background: var(--color-background); border: 1px solid var(--color-border);">
            <div class="px-4 py-3 flex items-center gap-2" style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(239,68,68,0.05) 0%, transparent 100%);">
              <span class="w-5 h-5 rounded flex items-center justify-center bg-red-500/10">
                <svg class="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
                </svg>
              </span>
              <h4 class="text-sm font-semibold" style="color: var(--color-text-primary);">Redis</h4>
              <span class="ml-auto text-xs font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-600">v{{ appMetrics!.redis!.redisVersion }}</span>
            </div>
            <div class="p-4">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Memoria</p>
                  <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.usedMemory }}</p>
                </div>
                <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Clientes</p>
                  <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.connectedClients }}</p>
                </div>
                <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Ops/seg</p>
                  <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.opsPerSec }}</p>
                </div>
                <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Hit Rate</p>
                  <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ hitRate }}%</p>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <div class="p-2 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Max Memory</p>
                  <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ appMetrics!.redis!.maxMemory }}</p>
                </div>
                <div class="p-2 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Eviction</p>
                  <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ appMetrics!.redis!.evictionPolicy }}</p>
                </div>
                <div class="p-2 rounded-lg text-center" style="background: var(--color-surface);">
                  <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Uptime</p>
                  <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ formatUptime(appMetrics!.redis!.uptimeInSeconds) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./monitoring.component.css'],
})
export class MonitoringComponent implements OnInit, OnDestroy {
  overview: MonitoringOverview | null = null;
  ec2Metrics: Ec2MetricsResponse | null = null;
  rdsMetrics: RdsMetricsResponse | null = null;
  appMetrics: AppMetrics | null = null;
  serverInfo: ServerInfo | null = null;

  loadingOverview = true;
  loadingEc2 = true;
  loadingRds = true;
  loadingApp = true;

  performanceSnapshot: PerformanceSnapshot | null = null;
  performanceHistory: PerformanceHistory | null = null;
  loadingPerformance = true;
  performanceTimeRange: TimeRange = '1h';

  ec2TimeRange: TimeRange = '1h';
  rdsTimeRange: TimeRange = '1h';

  private destroy$ = new Subject<void>();
  private paused = false;
  private visibilityHandler = () => this.onVisibilityChange();

  constructor(private readonly monitoringService: MonitoringService) {}

  // -- Computed values for stats cards --

  get overallStatus(): MetricStatus {
    return this.overview?.ec2?.status || 'healthy';
  }

  get overallStatusLabel(): string {
    switch (this.overallStatus) {
      case 'healthy':
        return 'Saludable';
      case 'warning':
        return 'Advertencia';
      case 'critical':
        return 'Critico';
      default:
        return 'Desconocido';
    }
  }

  get ec2CpuValue(): string {
    return this.overview ? `${this.overview.ec2.cpuUtilization.toFixed(1)}%` : '--';
  }

  get ec2CpuSmall(): string {
    return this.overview?.ec2?.status || '';
  }

  get ec2CpuBg(): string {
    return this.getCpuBg(this.overview?.ec2?.cpuUtilization);
  }

  get ec2CpuColor(): string {
    return this.getCpuColor(this.overview?.ec2?.cpuUtilization);
  }

  get rdsCpuValue(): string {
    return this.overview ? `${this.overview.rds.cpuUtilization.toFixed(1)}%` : '--';
  }

  get rdsConnectionsSmall(): string {
    return this.overview ? `${this.overview.rds.connections} conexiones` : '';
  }

  get rdsCpuBg(): string {
    return this.getCpuBg(this.overview?.rds?.cpuUtilization);
  }

  get rdsCpuColor(): string {
    return this.getCpuColor(this.overview?.rds?.cpuUtilization);
  }

  get memoryValue(): string {
    return this.overview
      ? `${this.overview.server.memoryUsedPercent.toFixed(1)}%`
      : '--';
  }

  get memorySmall(): string {
    if (!this.overview) return '';
    const la = this.overview.server.loadAverage;
    return la?.length ? `Load: ${la[0].toFixed(2)}` : '';
  }

  get diskValue(): string {
    return this.overview?.server?.disk?.usePercent || '--';
  }

  get diskSmall(): string {
    if (!this.overview?.server?.disk) return '';
    return `${this.overview.server.disk.used} / ${this.overview.server.disk.size}`;
  }

  // Performance computed values
  get avgResponseTime(): string {
    return this.performanceSnapshot ? `${this.performanceSnapshot.responseTime.mean.toFixed(0)}ms` : '--';
  }

  get avgResponseTimeBg(): string {
    const ms = this.performanceSnapshot?.responseTime.mean ?? 0;
    if (ms >= 500) return 'bg-red-500/10';
    if (ms >= 200) return 'bg-yellow-500/10';
    return 'bg-green-500/10';
  }

  get avgResponseTimeColor(): string {
    const ms = this.performanceSnapshot?.responseTime.mean ?? 0;
    if (ms >= 500) return 'text-red-500';
    if (ms >= 200) return 'text-yellow-500';
    return 'text-green-500';
  }

  get reqPerSec(): string {
    return this.performanceSnapshot ? `${this.performanceSnapshot.throughput.current.toFixed(1)}` : '--';
  }

  get errorRate(): string {
    if (!this.performanceSnapshot) return '--';
    const e = this.performanceSnapshot.errors.last5min;
    if (e.total === 0) return '0%';
    return `${(((e.errors4xx + e.errors5xx) / e.total) * 100).toFixed(1)}%`;
  }

  get errorRateBg(): string {
    if (!this.performanceSnapshot) return 'bg-green-500/10';
    const e = this.performanceSnapshot.errors.last5min;
    const rate = e.total > 0 ? (e.errors4xx + e.errors5xx) / e.total * 100 : 0;
    if (rate >= 5) return 'bg-red-500/10';
    if (rate >= 1) return 'bg-yellow-500/10';
    return 'bg-green-500/10';
  }

  get errorRateColor(): string {
    if (!this.performanceSnapshot) return 'text-green-500';
    const e = this.performanceSnapshot.errors.last5min;
    const rate = e.total > 0 ? (e.errors4xx + e.errors5xx) / e.total * 100 : 0;
    if (rate >= 5) return 'text-red-500';
    if (rate >= 1) return 'text-yellow-500';
    return 'text-green-500';
  }

  get eventLoopP99(): string {
    return this.performanceSnapshot?.eventLoop?.current ? `${this.performanceSnapshot.eventLoop.current.p99.toFixed(1)}ms` : '--';
  }

  get eventLoopBg(): string {
    const ms = this.performanceSnapshot?.eventLoop?.current?.p99 ?? 0;
    if (ms >= 100) return 'bg-red-500/10';
    if (ms >= 50) return 'bg-yellow-500/10';
    return 'bg-green-500/10';
  }

  get eventLoopColor(): string {
    const ms = this.performanceSnapshot?.eventLoop?.current?.p99 ?? 0;
    if (ms >= 100) return 'text-red-500';
    if (ms >= 50) return 'text-yellow-500';
    return 'text-green-500';
  }

  // Time series mappers for charts
  get rtP50Points(): TimeSeriesPoint[] {
    return this.performanceHistory?.responseTimes?.map(r => ({ timestamp: r.timestamp, value: r.p50 })) || [];
  }
  get rtP95Points(): TimeSeriesPoint[] {
    return this.performanceHistory?.responseTimes?.map(r => ({ timestamp: r.timestamp, value: r.p95 })) || [];
  }
  get rtP99Points(): TimeSeriesPoint[] {
    return this.performanceHistory?.responseTimes?.map(r => ({ timestamp: r.timestamp, value: r.p99 })) || [];
  }
  get throughputPoints(): TimeSeriesPoint[] {
    return this.performanceHistory?.throughput?.map(t => ({ timestamp: t.timestamp, value: t.requestsPerSecond })) || [];
  }
  get errors4xxPoints(): TimeSeriesPoint[] {
    return this.performanceHistory?.errors?.map(e => ({ timestamp: e.timestamp, value: e.errors4xx })) || [];
  }
  get errors5xxPoints(): TimeSeriesPoint[] {
    return this.performanceHistory?.errors?.map(e => ({ timestamp: e.timestamp, value: e.errors5xx })) || [];
  }
  get eventLoopLagPoints(): TimeSeriesPoint[] {
    return this.performanceHistory?.eventLoopLag?.map(e => ({ timestamp: e.timestamp, value: e.p99 })) || [];
  }

  get hitRate(): string {
    if (!this.appMetrics?.redis) return '0';
    const hits = this.appMetrics.redis.keyspaceHits;
    const misses = this.appMetrics.redis.keyspaceMisses;
    const total = hits + misses;
    if (total === 0) return '0';
    return ((hits / total) * 100).toFixed(1);
  }

  // -- Lifecycle --

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Fetch server info once
    this.monitoringService
      .getServerInfo()
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => (this.serverInfo = data));

    // Poll overview + app metrics every 30s
    timer(0, 30000)
      .pipe(
        filter(() => !this.paused),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.fetchOverview();
        this.fetchAppMetrics();
        this.fetchPerformance();
        this.fetchPerformanceHistory();
      });

    // Poll EC2/RDS metrics every 60s
    timer(0, 60000)
      .pipe(
        filter(() => !this.paused),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.fetchEc2Metrics();
        this.fetchRdsMetrics();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  // -- Time range changes --

  onEc2TimeRangeChange(range: TimeRange): void {
    this.ec2TimeRange = range;
    this.fetchEc2Metrics();
  }

  onRdsTimeRangeChange(range: TimeRange): void {
    this.rdsTimeRange = range;
    this.fetchRdsMetrics();
  }

  onPerformanceTimeRangeChange(range: TimeRange): void {
    this.performanceTimeRange = range;
    this.fetchPerformanceHistory();
  }

  // -- Formatters --

  formatUptime(seconds?: number): string {
    if (!seconds) return '--';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }

  formatBytes(bytes?: number): string {
    return _formatBytes(bytes);
  }

  // -- Private helpers --

  private getCpuBg(cpu?: number): string {
    if (cpu === undefined || cpu === null) return 'bg-green-500/10';
    if (cpu > 80) return 'bg-red-500/10';
    if (cpu > 50) return 'bg-yellow-500/10';
    return 'bg-green-500/10';
  }

  private getCpuColor(cpu?: number): string {
    if (cpu === undefined || cpu === null) return 'text-green-500';
    if (cpu > 80) return 'text-red-500';
    if (cpu > 50) return 'text-yellow-500';
    return 'text-green-500';
  }

  private onVisibilityChange(): void {
    this.paused = document.hidden;
  }

  private fetchOverview(): void {
    this.monitoringService
      .getOverview()
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.overview = data;
        this.loadingOverview = false;
      });
  }

  private fetchEc2Metrics(): void {
    this.loadingEc2 = true;
    this.monitoringService
      .getEc2Metrics(this.ec2TimeRange)
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.ec2Metrics = data;
        this.loadingEc2 = false;
      });
  }

  private fetchRdsMetrics(): void {
    this.loadingRds = true;
    this.monitoringService
      .getRdsMetrics(this.rdsTimeRange)
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.rdsMetrics = data;
        this.loadingRds = false;
      });
  }

  private fetchPerformance(): void {
    this.monitoringService.getPerformance().pipe(
      map((res) => res.data),
      catchError(() => of(null)),
      takeUntil(this.destroy$),
    ).subscribe((data) => {
      this.performanceSnapshot = data;
      this.loadingPerformance = false;
    });
  }

  private fetchPerformanceHistory(): void {
    this.monitoringService.getPerformanceHistory(this.performanceTimeRange).pipe(
      map((res) => res.data),
      catchError(() => of(null)),
      takeUntil(this.destroy$),
    ).subscribe((data) => {
      this.performanceHistory = data;
    });
  }

  private fetchAppMetrics(): void {
    this.monitoringService
      .getAppMetrics()
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.appMetrics = data;
        this.loadingApp = false;
      });
  }
}
