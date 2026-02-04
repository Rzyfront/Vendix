import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import {
  DashboardOverviewComponent,
  DashboardSalesComponent,
  DashboardInventoryComponent,
  DashboardFinancialComponent,
  DashboardTab,
} from './components';

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    DashboardOverviewComponent,
    DashboardSalesComponent,
    DashboardInventoryComponent,
    DashboardFinancialComponent,
  ],
  template: `
    <div class="w-full">
      @if (!storeId()) {
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p class="text-text-secondary">Cargando...</p>
          </div>
        </div>
      } @else {
        <!-- Tab Content (tabs are inside each component, after stats) -->
        @switch (activeTab()) {
          @case ('overview') {
            <app-dashboard-overview
              [storeId]="storeId()!"
              [tabs]="tabs"
              [activeTab]="activeTab()"
              (tabChange)="setActiveTab($event)"
            ></app-dashboard-overview>
          }
          @case ('sales') {
            <app-dashboard-sales
              [storeId]="storeId()!"
              [tabs]="tabs"
              [activeTab]="activeTab()"
              (tabChange)="setActiveTab($event)"
            ></app-dashboard-sales>
          }
          @case ('inventory') {
            <app-dashboard-inventory
              [storeId]="storeId()!"
              [tabs]="tabs"
              [activeTab]="activeTab()"
              (tabChange)="setActiveTab($event)"
            ></app-dashboard-inventory>
          }
          @case ('financial') {
            <app-dashboard-financial
              [storeId]="storeId()!"
              [tabs]="tabs"
              [activeTab]="activeTab()"
              (tabChange)="setActiveTab($event)"
            ></app-dashboard-financial>
          }
        }
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  tabs: DashboardTab[] = [
    { id: 'overview', label: 'Vista General', shortLabel: 'General', icon: 'layout-dashboard' },
    { id: 'sales', label: 'Ventas', shortLabel: 'Ventas', icon: 'shopping-cart' },
    { id: 'inventory', label: 'Inventario', shortLabel: 'Stock', icon: 'package' },
    { id: 'financial', label: 'Finanzas', shortLabel: 'Finanzas', icon: 'dollar-sign' },
  ];

  activeTab = signal<string>('overview');
  storeId = signal<string | null>(null);

  constructor(private authFacade: AuthFacade) {}

  ngOnInit(): void {
    this.authFacade.userStore$
      .pipe(takeUntil(this.destroy$))
      .subscribe((store: any) => {
        const storeId = store?.id;
        if (storeId && !this.storeId()) {
          this.storeId.set(String(storeId));
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setActiveTab(tabId: string): void {
    this.activeTab.set(tabId);
  }
}
