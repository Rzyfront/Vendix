import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  OrgInventoryDashboardService,
  OrgInventoryDashboardStats,
} from '../../services/org-inventory-dashboard.service';
import { InventoryShortcutCardComponent } from './components/inventory-shortcut-card.component';

/**
 * Default state for the dashboard stats signal. Real values arrive from
 * `OrgInventoryDashboardService.getDashboardStats()` after the first successful
 * fetch.
 */
const EMPTY_STATS: OrgInventoryDashboardStats = {
  total_skus: 0,
  active_locations: 0,
  active_suppliers: 0,
  recent_movements: 0,
  transfers_in_transit: 0,
  adjustments_pending: 0,
};

/**
 * ORG_ADMIN — Dashboard de inventario (`/admin/inventory`).
 *
 * Sirve como landing del módulo: muestra 4 KPIs sticky, un banner de scope si
 * la organización está en modo STORE, una grilla con 6 shortcut cards, y una
 * sección con tareas pendientes cuando hay transfers in-transit o ajustes
 * pending.
 *
 * Sin endpoint dedicado: el dashboard agrega 4 calls existentes
 * (`getStockLevels`, `getLocations`, `OrgTransfersService.list`,
 * `OrgAdjustmentsService.list` — más suppliers/movements para shortcuts) vía
 * `OrgInventoryDashboardService` (cache shareReplay 60s).
 */
@Component({
  selector: 'vendix-org-inventory-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    StatsComponent,
    AlertBannerComponent,
    CardComponent,
    IconComponent,
    InventoryShortcutCardComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class OrgInventoryDashboardComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly dashboardService = inject(OrgInventoryDashboardService);

  readonly stats = signal<OrgInventoryDashboardStats>(EMPTY_STATS);
  readonly stats_loading = signal<boolean>(false);
  readonly stats_error = signal<string | null>(null);

  readonly is_org_scope = computed(
    () => this.authFacade.operatingScope() === 'ORGANIZATION',
  );

  /** Shown only when there is at least one pending task. */
  readonly has_pending_tasks = computed(() => {
    const s = this.stats();
    return s.adjustments_pending > 0 || s.transfers_in_transit > 0;
  });

  /** Badge color for the adjustments shortcut: red when there is a backlog. */
  readonly adjustments_badge_color = computed<'red' | 'gray'>(() =>
    this.stats().adjustments_pending > 0 ? 'red' : 'gray',
  );

  /** Badge color for the transfers shortcut: amber when items are moving. */
  readonly transfers_badge_color = computed<'amber' | 'gray'>(() =>
    this.stats().transfers_in_transit > 0 ? 'amber' : 'gray',
  );

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    this.stats_loading.set(true);
    this.stats_error.set(null);

    this.dashboardService
      .getDashboardStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.stats_loading.set(false);
        },
        error: (error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('OrgInventoryDashboard: stats failed', error);
          this.stats_error.set(
            'No pudimos cargar los KPIs. Intenta refrescar.',
          );
          this.stats_loading.set(false);
        },
      });
  }
}
