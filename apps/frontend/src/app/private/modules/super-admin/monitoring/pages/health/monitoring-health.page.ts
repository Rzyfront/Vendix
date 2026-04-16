import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { DestroyRef } from '@angular/core';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ProcessInfoComponent, QueueStatsComponent } from '../../components';
import { MonitoringService } from '../../services';
import { AppMetrics, ServerInfo } from '../../interfaces';
import { formatBytes as _formatBytes } from '../../../../../../core/utils/format.utils';

@Component({
  selector: 'app-monitoring-health-page',
  standalone: true,
  imports: [CommonModule, CardComponent, IconComponent, ProcessInfoComponent, QueueStatsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Server Memory -->
      <app-card *ngIf="serverInfo?.memory" [padding]="false" customClasses="!p-6">
        <div class="flex items-center gap-2 mb-4">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10">
            <app-icon name="memory-stick" [size]="16" class="text-blue-500"></app-icon>
          </div>
          <h3 class="text-sm font-semibold" style="color: var(--color-text-primary);">Memoria del Servidor</h3>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Total</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.total) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Usado</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.used) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Libre</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(serverInfo!.memory.free) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
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
      </app-card>

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

      <!-- Redis Info -->
      <app-card *ngIf="appMetrics?.redis" [padding]="false" overflow="hidden" customClasses="!overflow-hidden">
        <div class="px-6 py-4 flex items-center gap-2" style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(239,68,68,0.05) 0%, transparent 100%);">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10">
            <svg class="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
            </svg>
          </div>
          <h3 class="text-sm font-semibold" style="color: var(--color-text-primary);">Redis</h3>
          <span class="ml-auto text-xs font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-600">v{{ appMetrics!.redis!.redisVersion }}</span>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Memoria</p>
              <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.usedMemory }}</p>
            </div>
            <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Clientes</p>
              <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.connectedClients }}</p>
            </div>
            <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Ops/seg</p>
              <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ appMetrics!.redis!.opsPerSec }}</p>
            </div>
            <div class="p-3 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Hit Rate</p>
              <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ hitRate }}%</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="p-2 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Max Memory</p>
              <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ appMetrics!.redis!.maxMemory }}</p>
            </div>
            <div class="p-2 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Eviction</p>
              <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ appMetrics!.redis!.evictionPolicy }}</p>
            </div>
            <div class="p-2 rounded-lg text-center" style="background: var(--color-background);">
              <p class="text-[9px] uppercase tracking-wider" style="color: var(--color-text-muted);">Uptime</p>
              <p class="font-mono text-xs" style="color: var(--color-text-secondary);">{{ formatUptime(appMetrics!.redis!.uptimeInSeconds) }}</p>
            </div>
          </div>
        </div>
      </app-card>
    </div>
  `,
})
export class MonitoringHealthPage implements OnInit {
  private readonly monitoringService = inject(MonitoringService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  appMetrics: AppMetrics | null = null;
  serverInfo: ServerInfo | null = null;
  loadingApp = true;

  // Pre-computed
  hitRate = '0';

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

    // Poll app metrics every 30s
    timer(0, 30_000).pipe(
      filter(() => !this.paused),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.fetchAppMetrics());
  }

  formatBytes(bytes?: number): string {
    return _formatBytes(bytes);
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

  private fetchAppMetrics(): void {
    this.monitoringService.getAppMetrics().pipe(
      map(res => res.data),
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.appMetrics = data;
      this.loadingApp = false;
      this.computeValues();
      this.cdr.markForCheck();
    });
  }

  private computeValues(): void {
    if (!this.appMetrics?.redis) {
      this.hitRate = '0';
      return;
    }
    const hits = this.appMetrics.redis.keyspaceHits;
    const misses = this.appMetrics.redis.keyspaceMisses;
    const total = hits + misses;
    this.hitRate = total === 0 ? '0' : ((hits / total) * 100).toFixed(1);
  }
}
