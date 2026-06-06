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
 * Accounting module shell. Owns a persistent sticky-header whose tabs centralize
 * every accounting sub-section (ledger core, cartera, taxes, reports) under a
 * single `<router-outlet>`. Tax sub-modules (retenciones / exógena / ICA) are
 * nested children in `accounting.routes.ts`, so navigating between any tab keeps
 * this header mounted — no more deep sidebar nesting.
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
    id: 'account-mappings',
    label: 'Mapeo de Cuentas',
    shortLabel: 'Mapeo',
    icon: 'shuffle',
    route: '/admin/accounting/account-mappings',
  },
  {
    id: 'flows',
    label: 'Flujos Contables',
    shortLabel: 'Flujos',
    icon: 'workflow',
    route: '/admin/accounting/flows',
  },
  {
    id: 'cartera',
    label: 'Cartera',
    shortLabel: 'Cartera',
    icon: 'wallet',
    route: '/admin/accounting/cartera',
  },
  {
    id: 'receivables',
    label: 'Cuentas por Cobrar',
    shortLabel: 'Por Cobrar',
    icon: 'arrow-down-circle',
    route: '/admin/accounting/receivables',
  },
  {
    id: 'payables',
    label: 'Cuentas por Pagar',
    shortLabel: 'Por Pagar',
    icon: 'arrow-up-circle',
    route: '/admin/accounting/payables',
  },
  {
    id: 'aging',
    label: 'Vencimientos',
    shortLabel: 'Vencim.',
    icon: 'clock',
    route: '/admin/accounting/aging',
  },
  {
    id: 'withholding-tax',
    label: 'Retenciones',
    shortLabel: 'Retenc.',
    icon: 'percent',
    route: '/admin/accounting/withholding-tax',
  },
  {
    id: 'exogenous',
    label: 'Info Exógena',
    shortLabel: 'Exógena',
    icon: 'file-spreadsheet',
    route: '/admin/accounting/exogenous',
  },
  {
    id: 'ica',
    label: 'ICA Municipal',
    shortLabel: 'ICA',
    icon: 'landmark',
    route: '/admin/accounting/ica',
  },
  {
    id: 'reports',
    label: 'Reportes',
    shortLabel: 'Reportes',
    icon: 'bar-chart-3',
    route: '/admin/accounting/reports',
  },
];
