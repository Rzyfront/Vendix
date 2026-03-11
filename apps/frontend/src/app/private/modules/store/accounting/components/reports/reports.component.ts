import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router, RouterModule, ActivatedRoute, NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

@Component({
  selector: 'vendix-reports',
  standalone: true,
  imports: [RouterModule, ScrollableTabsComponent],
  template: `
    <div class="w-full">
      <div class="px-2 md:px-0 mb-2 md:mb-4">
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
export class ReportsComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  tabs: ScrollableTab[] = [
    { id: 'trial-balance', label: 'Balance de Prueba', icon: 'file-text' },
    { id: 'balance-sheet', label: 'Balance General', icon: 'columns' },
    { id: 'income-statement', label: 'Estado de Resultados', icon: 'trending-up' },
    { id: 'general-ledger', label: 'Libro Mayor', icon: 'book' },
  ];
  activeTab = 'trial-balance';

  ngOnInit(): void {
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
