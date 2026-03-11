import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router, RouterModule, ActivatedRoute, NavigationEnd } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import { loadAccounts, loadFiscalPeriods } from './state/actions/accounting.actions';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

@Component({
  selector: 'vendix-accounting',
  standalone: true,
  imports: [RouterModule, ScrollableTabsComponent],
  template: `
    <div class="w-full">
      <div class="px-2 md:px-0 mb-3 md:mb-5">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab"
          size="sm"
          (tabChange)="switchTab($event)"
        ></app-scrollable-tabs>
      </div>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AccountingComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  tabs: ScrollableTab[] = [
    { id: 'chart-of-accounts', label: 'Plan de Cuentas', icon: 'book-open' },
    { id: 'journal-entries', label: 'Asientos', icon: 'file-text' },
    { id: 'fiscal-periods', label: 'Periodos Fiscales', icon: 'calendar' },
    { id: 'reports', label: 'Reportes', icon: 'bar-chart-2' },
  ];
  activeTab = 'chart-of-accounts';

  ngOnInit(): void {
    this.store.dispatch(loadAccounts());
    this.store.dispatch(loadFiscalPeriods());

    this.syncActiveTab();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe(() => this.syncActiveTab());
  }

  switchTab(tabId: string): void {
    this.router.navigate([tabId], { relativeTo: this.route });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private syncActiveTab(): void {
    const child = this.route.firstChild;
    if (child?.snapshot.url.length) {
      this.activeTab = child.snapshot.url[0].path;
    }
  }
}
