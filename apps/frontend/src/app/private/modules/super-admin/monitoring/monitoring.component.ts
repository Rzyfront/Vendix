import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, timer } from 'rxjs';
import { takeUntil, map, catchError, filter } from 'rxjs/operators';
import { of } from 'rxjs';
import { StatsComponent } from '../../../../shared/components';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { MonitoringService } from './services';
import {
  MetricChartComponent,
  TimeRangeSelectorComponent,
  StatusIndicatorComponent,
  ProcessInfoComponent,
  QueueStatsComponent,
} from './components';
import {
  MonitoringOverview,
  Ec2MetricsResponse,
  RdsMetricsResponse,
  AppMetrics,
  ServerInfo,
  TimeRange,
  MetricStatus,
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
  ],
  providers: [MonitoringService],
  template: `
    <div style="background-color: var(--color-background);" class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8), rgba(126, 215, 165, 0.6));"
          >
            <app-icon name="activity" [size]="20" class="text-white"></app-icon>
          </div>
          <div>
            <h2 class="text-xl font-bold" style="color: var(--color-text-primary);">
              Monitoreo del Servidor
            </h2>
            <p class="text-sm" style="color: var(--color-text-muted);">
              Metricas en tiempo real de infraestructura y aplicacion
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <app-status-indicator
            [status]="overallStatus"
            [label]="overallStatusLabel"
          ></app-status-indicator>
          <span class="text-xs" style="color: var(--color-text-muted);">Auto-refresh: 30s</span>
        </div>
      </div>

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

      <!-- Uptime bar -->
      <div
        class="rounded-card shadow-card p-4 flex items-center gap-4"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <app-icon name="clock" [size]="18" style="color: var(--color-text-muted);"></app-icon>
        <span style="color: var(--color-text-secondary);">
          Uptime del servidor:
          <strong style="color: var(--color-text-primary);">{{ formatUptime(overview?.server?.uptime) }}</strong>
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
    if (bytes === undefined || bytes === null) return '--';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
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
