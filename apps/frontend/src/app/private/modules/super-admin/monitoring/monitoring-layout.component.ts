import { Component, computed, DestroyRef, inject, signal } from '@angular/core';

import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { StickyHeaderComponent, StickyHeaderActionButton } from '../../../../shared/components/sticky-header/sticky-header.component';
import { MonitoringService } from './services/monitoring.service';

@Component({
  selector: 'app-monitoring-layout',
  standalone: true,
  imports: [RouterModule, IconComponent, StickyHeaderComponent],
  template: `
    <app-sticky-header
      title="Monitoreo del Sistema"
      subtitle="Estado en tiempo real de la infraestructura"
      icon="activity"
      [metadataContent]="'Ultima actualizacion: hace ' + secondsSinceRefresh() + 's'"
      [actions]="headerActions()"
      (actionClicked)="onHeaderAction($event)"
    ></app-sticky-header>

    <!-- Tabs -->
    <div class="flex items-center gap-1 border-b border-border px-4 md:px-6">
      @for (tab of tabs; track tab) {
        <a
          [routerLink]="tab.path"
          routerLinkActive #rla="routerLinkActive"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
          [class.text-primary]="rla.isActive"
          [class.text-text-secondary]="!rla.isActive"
          >
          <app-icon [name]="tab.icon" [size]="16"></app-icon>
          {{ tab.label }}
          @if (rla.isActive) {
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full"
            ></span>
          }
        </a>
      }
    </div>

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

  readonly tabs = [
    { path: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { path: 'infrastructure', label: 'Infraestructura', icon: 'server' },
    { path: 'performance', label: 'Performance', icon: 'zap' },
    { path: 'health', label: 'Salud', icon: 'heart-pulse' },
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
