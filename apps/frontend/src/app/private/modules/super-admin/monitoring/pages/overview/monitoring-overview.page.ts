import { Component, inject, DestroyRef } from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { StatsComponent } from '../../../../../../shared/components';
import { StatusIndicatorComponent } from '../../components';
import { MonitoringService } from '../../services';
import { MonitoringOverview, ServerInfo, MetricStatus } from '../../interfaces';

@Component({
  selector: 'app-monitoring-overview-page',
  standalone: true,
  imports: [StatsComponent, StatusIndicatorComponent],
  template: `
    <div class="space-y-6">
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

      <!-- Overall Status -->
      <div class="p-4 rounded-xl" style="background: var(--color-surface); border: 1px solid var(--color-border);">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <app-status-indicator [status]="overallStatus"></app-status-indicator>
            <span class="text-sm font-medium" style="color: var(--color-text-primary);">Estado General</span>
          </div>
          <span class="text-sm" style="color: var(--color-text-muted);">{{ overallStatusLabel }}</span>
        </div>
      </div>

      <!-- Server Info -->
      @if (serverInfo) {
        <div class="p-4 rounded-xl" style="background: var(--color-surface); border: 1px solid var(--color-border);">
          <h3 class="text-sm font-semibold mb-3" style="color: var(--color-text-primary);">Informacion del Servidor</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-[10px] uppercase" style="color: var(--color-text-muted);">Hostname</p>
              <p class="font-mono text-sm" style="color: var(--color-text-primary);">{{ serverInfo.hostname }}</p>
            </div>
            <div>
              <p class="text-[10px] uppercase" style="color: var(--color-text-muted);">Plataforma</p>
              <p class="font-mono text-sm" style="color: var(--color-text-primary);">{{ serverInfo.platform }}</p>
            </div>
            <div>
              <p class="text-[10px] uppercase" style="color: var(--color-text-muted);">Node.js</p>
              <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ serverInfo.nodeVersion }}</p>
            </div>
          </div>
        </div>
      }
    </div>
    `,
})
export class MonitoringOverviewPage {
  private readonly monitoringService = inject(MonitoringService);
  private readonly destroyRef = inject(DestroyRef);

  overview: MonitoringOverview | null = null;
  serverInfo: ServerInfo | null = null;
  loadingOverview = true;

  // Pre-computed values (NOT getters)
  overallStatus: MetricStatus = 'healthy';
  overallStatusLabel = 'Cargando...';
  ec2CpuValue = '--';
  ec2CpuSmall = '';
  ec2CpuBg = 'bg-green-500/10';
  ec2CpuColor = 'text-green-500';
  rdsCpuValue = '--';
  rdsConnectionsSmall = '';
  rdsCpuBg = 'bg-green-500/10';
  rdsCpuColor = 'text-green-500';
  memoryValue = '--';
  memorySmall = '';
  diskValue = '--';
  diskSmall = '';

  private paused = false;
  private visibilityHandler = () => { this.paused = document.hidden; };

  constructor() {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Fetch server info once
    this.monitoringService.getServerInfo().pipe(
      map(res => res.data),
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.serverInfo = data;
    });

    // Poll overview every 60s
    timer(0, 60_000).pipe(
      filter(() => !this.paused),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.fetchOverview());

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    });
  }

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

  private fetchOverview(): void {
    this.monitoringService.getOverview().pipe(
      map(res => res.data),
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.overview = data;
      this.loadingOverview = false;
      this.computeOverviewValues();
    });
  }

  private computeOverviewValues(): void {
    if (!this.overview) return;
    const o = this.overview;

    this.overallStatus = o.ec2.status;
    this.overallStatusLabel = o.ec2.status === 'healthy' ? 'Saludable' : o.ec2.status === 'warning' ? 'Advertencia' : 'Critico';

    this.ec2CpuValue = `${o.ec2.cpuUtilization.toFixed(1)}%`;
    this.ec2CpuSmall = o.ec2.status;
    this.ec2CpuBg = this.getCpuBg(o.ec2.cpuUtilization);
    this.ec2CpuColor = this.getCpuColor(o.ec2.cpuUtilization);

    this.rdsCpuValue = `${o.rds.cpuUtilization.toFixed(1)}%`;
    this.rdsConnectionsSmall = `${o.rds.connections} conexiones`;
    this.rdsCpuBg = this.getCpuBg(o.rds.cpuUtilization);
    this.rdsCpuColor = this.getCpuColor(o.rds.cpuUtilization);

    this.memoryValue = `${o.server.memoryUsedPercent.toFixed(1)}%`;
    const la = o.server.loadAverage;
    this.memorySmall = la?.length ? `Load: ${la[0].toFixed(2)}` : '';

    this.diskValue = o.server.disk?.usePercent || '--';
    this.diskSmall = o.server.disk ? `${o.server.disk.used} / ${o.server.disk.size}` : '';
  }

  private getCpuBg(cpu: number): string {
    if (cpu > 80) return 'bg-red-500/10';
    if (cpu > 50) return 'bg-yellow-500/10';
    return 'bg-green-500/10';
  }

  private getCpuColor(cpu: number): string {
    if (cpu > 80) return 'text-red-500';
    if (cpu > 50) return 'text-yellow-500';
    return 'text-green-500';
  }
}
