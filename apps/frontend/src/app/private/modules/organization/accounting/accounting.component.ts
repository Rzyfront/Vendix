import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterModule,
} from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import { OrgFiscalScopeSelectorComponent } from '../shared/components/org-fiscal-scope-selector.component';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Org-scoped accounting shell.
 * Owns a persistent sticky-header whose tabs centralize the read-only
 * consolidated accounting sub-pages (/api/organization/accounting/*) under a
 * single `<router-outlet>` — mirrors the store accounting shell, including its
 * super-tab architecture: Configuración (mapeos), Cartera (dashboard + CxC +
 * CxP + vencimientos) and Impuestos (retenciones / exógena / ICA) group their
 * sub-pages with internal sub-navigation via the shared
 * `AccountingSubTabsShellComponent`; legacy flat routes redirect to the new
 * nested paths. The org sidebar can collapse "Contabilidad" to a single leaf,
 * and the fiscal-scope selector stays mounted across every tab to filter by
 * store.
 */
@Component({
  selector: 'vendix-org-accounting',
  standalone: true,
  imports: [RouterModule, OrgFiscalScopeSelectorComponent, StickyHeaderComponent],
  template: `
    <section class="org-accounting-shell">
      <app-sticky-header
        title="Contabilidad"
        subtitle="Vista consolidada"
        icon="book-open"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/fiscal"
        [tabs]="tabs()"
        [activeTab]="activeTabId()"
        tabsAriaLabel="Secciones de contabilidad"
        (tabChanged)="onTabChanged($event)"
      ></app-sticky-header>

      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="org-accounting-shell__body">
        <router-outlet></router-outlet>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .org-accounting-shell {
        width: 100%;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .org-accounting-shell__body {
        width: 100%;
      }
    `,
  ],
})
export class OrgAccountingComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedStoreId = signal<number | null>(null);

  readonly tabs = computed<StickyHeaderTab[]>(() => TAB_DEFINITIONS);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly activeTabId = computed<string>(() => {
    const url = this.currentUrl().split('?')[0];
    const match = TAB_DEFINITIONS.find((tab) => {
      const route = typeof tab.route === 'string' ? tab.route : '';
      return route && (url === route || url.startsWith(`${route}/`));
    });
    return match?.id ?? TAB_DEFINITIONS[0]?.id ?? '';
  });

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const raw = params.get('store_id');
        const storeId = raw ? Number(raw) : null;
        this.selectedStoreId.set(Number.isFinite(storeId) ? storeId : null);
      });
  }

  onTabChanged(tabId: string): void {
    const target = TAB_DEFINITIONS.find((tab) => tab.id === tabId);
    const route = typeof target?.route === 'string' ? target.route : null;
    if (route) {
      const storeId = this.selectedStoreId();
      void this.router.navigate([route], {
        queryParams: storeId ? { store_id: storeId } : {},
      });
    }
  }

  onFiscalStoreChange(storeId: number | null): void {
    this.selectedStoreId.set(storeId);
    this.syncStoreQueryParam(storeId);
  }

  private syncStoreQueryParam(storeId: number | null): void {
    this.router.navigate([], {
      queryParams: { store_id: storeId || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

const TAB_DEFINITIONS: StickyHeaderTab[] = [
  {
    id: 'chart-of-accounts',
    label: 'Plan de Cuentas',
    shortLabel: 'Cuentas',
    icon: 'list-tree',
    route: '/admin/accounting/chart-of-accounts',
  },
  {
    id: 'journal-entries',
    label: 'Asientos',
    shortLabel: 'Asientos',
    icon: 'book-open',
    route: '/admin/accounting/journal-entries',
  },
  {
    id: 'fiscal-periods',
    label: 'Períodos',
    shortLabel: 'Períodos',
    icon: 'calendar-days',
    route: '/admin/accounting/fiscal-periods',
  },
  {
    id: 'consolidation',
    label: 'Consolidación',
    shortLabel: 'Consol.',
    icon: 'layers',
    route: '/admin/accounting/consolidation',
  },
  {
    id: 'configuration',
    label: 'Configuración',
    shortLabel: 'Config.',
    icon: 'settings',
    route: '/admin/accounting/configuration',
  },
  {
    id: 'cartera',
    label: 'Cartera',
    shortLabel: 'Cartera',
    icon: 'wallet',
    route: '/admin/accounting/cartera',
  },
  {
    id: 'taxes',
    label: 'Impuestos',
    shortLabel: 'Impuestos',
    icon: 'percent',
    route: '/admin/accounting/taxes',
  },
];
