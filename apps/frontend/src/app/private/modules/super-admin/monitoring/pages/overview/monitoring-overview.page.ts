import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { DestroyRef } from '@angular/core';
import { StatsComponent } from '../../../../../../shared/components';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatusIndicatorComponent } from '../../components';
import { MonitoringService } from '../../services';
import { MonitoringOverview, ServerInfo, MetricStatus } from '../../interfaces';

@Component({
  selector: 'app-monitoring-overview-page',
  standalone: true,
  imports: [CommonModule, StatsComponent, IconComponent, StatusIndicatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
          Auto-refresh: 60s
        </span>
      </div>

      <!-- Server Info Summary -->
      <div *ngIf="serverInfo" class="rounded-card shadow-card p-6" style="background: var(--color-surface); border: 1px solid var(--color-border);">
        <h3 class="text-sm font-semibold mb-4" style="color: var(--color-text-primary);">Informacion del Servidor</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Hostname</p>
            <p class="font-mono text-sm font-bold truncate" style="color: var(--color-text-primary);">{{ serverInfo.hostname }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Platform</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ serverInfo.platform }} {{ serverInfo.arch }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">CPUs</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ serverInfo.cpuCount }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Node.js</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ serverInfo.nodeVersion }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class MonitoringOverviewPage implements OnInit {
  private readonly monitoringService = inject(MonitoringService);
  private readonly cdr = inject(ChangeDetectorRef);
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

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Fetch server info once
    this.monitoringService.getServerInfo().pipe(
      map(res => res.data),
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.serverInfo = data;
      this.cdr.markForCheck();
    });

    // Poll overview every 60s
    timer(0, 60_000).pipe(
      filter(() => !this.paused),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.fetchOverview());
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
      this.cdr.markForCheck();
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
