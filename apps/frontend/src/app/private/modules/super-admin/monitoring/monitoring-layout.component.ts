import { Component, computed, DestroyRef, inject, signal } from '@angular/core';

import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';
import { MonitoringService } from './services/monitoring.service';

@Component({
  selector: 'app-monitoring-layout',
  standalone: true,
  imports: [RouterModule, StickyHeaderComponent],
  template: `
    <app-sticky-header
      title="Monitoreo del Sistema"
      subtitle="Estado en tiempo real de la infraestructura"
      icon="activity"
      [metadataContent]="'Ultima actualizacion: hace ' + secondsSinceRefresh() + 's'"
      [actions]="headerActions()"
      [tabs]="tabs"
      tabsAriaLabel="Secciones de monitoreo"
      (actionClicked)="onHeaderAction($event)"
    ></app-sticky-header>

    <!-- Content -->
    <div class="p-4 md:p-6">
      <router-outlet></router-outlet>
    </div>
    `,
})
export class MonitoringLayoutComponent {
  private readonly monitoringService = inject(MonitoringService);
  private readonly destroyRef = inject(DestroyRef);
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly secondsSinceRefresh = signal(0);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const autoRefresh = this.monitoringService.autoRefresh();
    return [
      { id: 'refresh', label: 'Refrescar', variant: 'outline', icon: 'refresh-cw' },
      {
        id: 'auto-refresh',
        label: autoRefresh ? 'Auto: ON' : 'Auto: OFF',
        variant: autoRefresh ? 'primary' : 'outline',
        icon: autoRefresh ? 'play' : 'pause',
      },
    ];
  });

  readonly tabs: StickyHeaderTab[] = [
    { id: 'overview', route: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { id: 'infrastructure', route: 'infrastructure', label: 'Infraestructura', shortLabel: 'Infra', icon: 'server' },
    { id: 'performance', route: 'performance', label: 'Performance', shortLabel: 'Perf', icon: 'zap' },
    { id: 'health', route: 'health', label: 'Salud', icon: 'heart-pulse' },
  ];

  constructor() {
    this.monitoringService.manualRefresh$.pipe(
      takeUntilDestroyed(),
    ).subscribe(() => {
      this.secondsSinceRefresh.set(0);
    });

    this.tickInterval = setInterval(() => {
      this.secondsSinceRefresh.update(v => v + 1);
    }, 1000);

    this.destroyRef.onDestroy(() => {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
      }
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') {
      this.monitoringService.triggerRefresh();
      this.secondsSinceRefresh.set(0);
    } else if (actionId === 'auto-refresh') {
      this.monitoringService.toggleAutoRefresh();
    }
  }
}
