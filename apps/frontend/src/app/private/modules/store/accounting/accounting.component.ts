import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import {
  loadAccounts,
  loadFiscalPeriods,
} from './state/actions/accounting.actions';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Accounting module shell. Owns a persistent sticky-header with 11 single-purpose
 * tabs under one `<router-outlet>`. Grouped functions live in super-tabs with
 * internal sub-navigation (see `AccountingSubTabsShellComponent`):
 * Configuración (mapeos + flujos), Cartera (dashboard + CxC + CxP + vencimientos)
 * and Impuestos (retenciones / exógena / tarifas ICA — lazy sub-modules mounted
 * as children in `accounting.routes.ts`). Navigating between tabs keeps this
 * header mounted; legacy flat routes redirect to the new nested paths.
 */
@Component({
  selector: 'vendix-accounting',
  standalone: true,
  imports: [CommonModule, RouterOutlet, StickyHeaderComponent],
  template: `
    <section class="accounting-shell">
      <app-sticky-header
        title="Contabilidad"
        subtitle="Contabilidad"
        icon="book-open"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/fiscal"
        [tabs]="tabs()"
        [activeTab]="activeTabId()"
        tabsAriaLabel="Secciones de contabilidad"
        (tabChanged)="onTabChanged($event)"
      ></app-sticky-header>

      <div class="accounting-shell__body">
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

      .accounting-shell {
        width: 100%;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .accounting-shell__body {
        width: 100%;
      }
    `,
  ],
})
export class AccountingComponent {
  private readonly store = inject(Store);
  private readonly router = inject(Router);

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
    this.store.dispatch(loadAccounts());
    this.store.dispatch(loadFiscalPeriods());
  }

  onTabChanged(tabId: string): void {
    const target = TAB_DEFINITIONS.find((tab) => tab.id === tabId);
    const route = typeof target?.route === 'string' ? target.route : null;
    if (route) {
      void this.router.navigateByUrl(route);
    }
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
  {
    id: 'bank-reconciliation',
    label: 'Bancos',
    shortLabel: 'Bancos',
    icon: 'banknote',
    route: '/admin/accounting/bank-reconciliation',
  },
  {
    id: 'fixed-assets',
    label: 'Activos fijos',
    shortLabel: 'Activos',
    icon: 'building-2',
    route: '/admin/accounting/fixed-assets',
  },
  {
    id: 'budgets',
    label: 'Presupuestos',
    shortLabel: 'Presup.',
    icon: 'piggy-bank',
    route: '/admin/accounting/budgets',
  },
  {
    id: 'consolidation',
    label: 'Consolidación',
    shortLabel: 'Consolid.',
    icon: 'layers',
    route: '/admin/accounting/consolidation',
  },
  {
    id: 'reports',
    label: 'Reportes',
    shortLabel: 'Reportes',
    icon: 'bar-chart-3',
    route: '/admin/accounting/reports',
  },
];
