import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  StoreDashboardService,
  StoreDashboardStats,
} from './services/store-dashboard.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <div *ngIf="loading" class="flex items-center justify-center h-64">
        <div
          class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"
        ></div>
      </div>

      <div *ngIf="!loading">
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div class="flex items-center justify-between mb-4">
              <div
                class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
              >
                <i class="fas fa-box text-xl text-green-600"></i>
              </div>
              <span
                class="text-sm font-medium"
                [ngStyle]="{
                  color: getGrowthColor(dashboardStats?.productsGrowth),
                }"
              >
                {{ formatGrowth(dashboardStats?.productsGrowth) }}
              </span>
            </div>
            <h3 class="text-sm font-medium text-gray-600">Total Products</h3>
            <p class="text-3xl font-bold mt-2 text-gray-900">
              {{ getTotalProducts() }}
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div class="flex items-center justify-between mb-4">
              <div
                class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
              >
                <i class="fas fa-users text-xl text-green-600"></i>
              </div>
              <span
                class="text-sm font-medium"
                [ngStyle]="{
                  color: getGrowthColor(dashboardStats?.customersGrowth),
                }"
              >
                {{ formatGrowth(dashboardStats?.customersGrowth) }}
              </span>
            </div>
            <h3 class="text-sm font-medium text-gray-600">Total Customers</h3>
            <p class="text-3xl font-bold mt-2 text-gray-900">
              {{ getTotalCustomers() }}
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div class="flex items-center justify-between mb-4">
              <div
                class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
              >
                <i class="fas fa-shopping-cart text-xl text-green-600"></i>
              </div>
              <span
                class="text-sm font-medium"
                [ngStyle]="{
                  color: getGrowthColor(dashboardStats?.ordersGrowth),
                }"
              >
                {{ formatGrowth(dashboardStats?.ordersGrowth) }}
              </span>
            </div>
            <h3 class="text-sm font-medium text-gray-600">Monthly Orders</h3>
            <p class="text-3xl font-bold mt-2 text-gray-900">
              {{ getMonthlyOrders() }}
            </p>
          </div>

          <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div class="flex items-center justify-between mb-4">
              <div
                class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
              >
                <i class="fas fa-dollar-sign text-xl text-green-600"></i>
              </div>
              <span
                class="text-sm font-medium"
                [ngStyle]="{
                  color: getGrowthColor(dashboardStats?.revenueGrowth),
                }"
              >
                {{ formatGrowth(dashboardStats?.revenueGrowth) }}
              </span>
            </div>
            <h3 class="text-sm font-medium text-gray-600">Monthly Revenue</h3>
            <p class="text-3xl font-bold mt-2 text-gray-900">
              $ {{ getMonthlyRevenue() }}
            </p>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200">
          <div class="px-6 py-4 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-900">Recent Orders</h2>
          </div>
          <div class="p-6">
            <div *ngIf="hasRecentOrders()" class="space-y-4">
              <div
                class="flex items-start gap-4"
                *ngFor="let order of recentOrders"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-green-100"
                >
                  <i class="fas fa-shopping-cart text-green-600"></i>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium text-gray-900">
                    Order #{{ order.id }}
                  </p>
                  <p class="text-sm text-gray-600">
                    {{ order.customerName }} - {{ order.items }} items
                  </p>
                  <p class="text-sm font-medium text-green-600">
                    $ {{ order.amount }}
                  </p>
                  <p class="text-xs text-gray-400 mt-1">
                    {{ order.timestamp | date: 'short' }}
                  </p>
                </div>
                <div class="flex-shrink-0">
                  <span
                    class="px-2 py-1 text-xs rounded-full"
                    [ngClass]="getStatusClass(order.status)"
                  >
                    {{ order.status | titlecase }}
                  </span>
                </div>
              </div>
            </div>
            <div *ngIf="!hasRecentOrders()" class="text-center text-gray-500">
              No recent orders found
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .status-pending {
        background-color: #fef3c7;
        color: #92400e;
      }
      .status-processing {
        background-color: #dbeafe;
        color: #1e40af;
      }
      .status-shipped {
        background-color: #e0e7ff;
        color: #3730a3;
      }
      .status-delivered {
        background-color: #d1fae5;
        color: #065f46;
      }
      .status-cancelled {
        background-color: #fee2e2;
        color: #991b1b;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  dashboardStats: StoreDashboardStats | null = null;
  loading = true;
  storeId: string | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private storeDashboardService: StoreDashboardService,
  ) {}

  ngOnInit(): void {
    const id = this.route.parent?.snapshot.paramMap.get('id');
    this.storeId = id || null;
    if (this.storeId) {
      this.loadDashboardStats();
    } else {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDashboardStats(): void {
    if (!this.storeId) return;

    this.storeDashboardService
      .getDashboardStats(this.storeId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: StoreDashboardStats) => {
          this.dashboardStats = stats;
          this.loading = false;
        },
        error: (error: any) => {
          console.error('Error loading dashboard stats:', error);
          this.loading = false;
        },
      });
  }

  getTotalProducts(): number {
    return this.dashboardStats?.totalProducts || 0;
  }

  getTotalCustomers(): number {
    return this.dashboardStats?.totalCustomers || 0;
  }

  getMonthlyOrders(): number {
    return this.dashboardStats?.monthlyOrders || 0;
  }

  getMonthlyRevenue(): number {
    return this.dashboardStats?.monthlyRevenue || 0;
  }

  hasRecentOrders(): boolean {
    return !!(
      this.dashboardStats?.recentOrders &&
      this.dashboardStats.recentOrders.length > 0
    );
  }

  get recentOrders() {
    return this.dashboardStats?.recentOrders || [];
  }

  getGrowthColor(growth?: number): string {
    if (!growth) return '#6B7280';
    return growth > 0 ? '#10B981' : '#EF4444';
  }

  formatGrowth(growth?: number): string {
    if (!growth) return '0%';
    return (growth > 0 ? '+' : '') + growth + '%';
  }

  getStatusClass(status: string): string {
    return 'status-' + status.toLowerCase();
  }
}
