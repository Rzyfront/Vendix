import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import {
  StoreDashboardService,
  StoreDashboardStats,
} from './services/store-dashboard.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { StatsComponent, IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [CommonModule, StatsComponent, IconComponent],
  template: `
    <div class="space-y-6">
      <div *ngIf="loading" class="flex items-center justify-center h-64">
        <div
          class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"
        ></div>
      </div>

      <div *ngIf="!loading">
        <!-- Stats Cards -->
        <div class="stats-container">
          <app-stats
            title="Total de Productos"
            [value]="getTotalProducts()"
            [smallText]="formatGrowth(dashboardStats?.productsGrowth)"
            iconName="package"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Total de Clientes"
            [value]="getTotalCustomers()"
            [smallText]="formatGrowth(dashboardStats?.customersGrowth)"
            iconName="users"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Órdenes Mensuales"
            [value]="getMonthlyOrders()"
            [smallText]="formatGrowth(dashboardStats?.ordersGrowth)"
            iconName="shopping-cart"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>

          <app-stats
            title="Ingresos Mensuales"
            [value]="'$ ' + getMonthlyRevenue()"
            [smallText]="formatGrowth(dashboardStats?.revenueGrowth)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>

        <!-- Recent Orders -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200">
          <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 class="text-lg font-semibold text-gray-900">Órdenes Recientes</h2>
            <button
              class="text-sm text-primary hover:text-primary/80 font-medium"
              (click)="viewAllOrders()"
            >
              Ver todas →
            </button>
          </div>

          <div *ngIf="!hasRecentOrders()" class="p-12 text-center">
            <app-icon name="shopping-cart" [size]="48" class="text-gray-300 mx-auto mb-4"></app-icon>
            <p class="text-gray-500">No hay órdenes recientes</p>
            <button
              class="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              (click)="viewAllOrders()"
            >
              Ver Órdenes
            </button>
          </div>

          <div *ngIf="hasRecentOrders()" class="divide-y divide-gray-100">
            <div
              *ngFor="let order of recentOrders.slice(0, 5)"
              class="p-4 hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-4"
              (click)="viewOrder(order.id)"
            >
              <!-- Status Icon -->
              <div class="flex-shrink-0">
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center"
                  [ngClass]="getStatusIconBg(order.status)"
                >
                  <app-icon
                    [name]="getStatusIcon(order.status)"
                    [size]="20"
                    [ngClass]="getStatusIconColor(order.status)"
                  ></app-icon>
                </div>
              </div>

              <!-- Order Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <h3 class="text-sm font-medium text-gray-900 truncate">
                    {{ order.customerName || 'Consumidor Final' }}
                  </h3>
                  <span
                    class="inline-flex items-center justify-center text-xs font-medium px-2.5 py-1 rounded-full"
                    [ngClass]="getStatusBadgeClass(order.status)"
                  >
                    {{ getStatusLabel(order.status) }}
                  </span>
                </div>
                <div class="flex items-center gap-4 text-xs text-gray-500">
                  <span>{{ formatRelativeTime(order.timestamp) }}</span>
                  <span>•</span>
                  <span>{{ order.items }} {{ order.items === 1 ? 'producto' : 'productos' }}</span>
                </div>
              </div>

              <!-- Amount -->
              <div class="flex-shrink-0 text-right">
                <div class="text-lg font-semibold text-gray-900">
                  {{ formatCurrency(order.amount) }}
                </div>
              </div>
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
    private authFacade: AuthFacade,
    private storeDashboardService: StoreDashboardService,
    private router: Router,
  ) { }

  ngOnInit(): void {
    console.log('[StoreDashboard] ngOnInit - initializing dashboard component');

    // Subscribe to userStore$ observable to get the store ID
    this.authFacade.userStore$
      .pipe(takeUntil(this.destroy$))
      .subscribe((store: any) => {
        console.log('[StoreDashboard] userStore$ emitted:', store);

        const storeId = store?.id;
        if (storeId && !this.storeId) {
          console.log('[StoreDashboard] Found store ID:', storeId);
          this.storeId = String(storeId);
          this.loadDashboardStats();
        } else if (!this.storeId) {
          console.warn('[StoreDashboard] Store emitted but no ID found', store);
        }
      });
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

  // New methods for creative order cards
  getStatusStripClass(status: string): string {
    const statusMap: Record<string, string> = {
      pending: 'bg-yellow-400',
      processing: 'bg-blue-500',
      shipped: 'bg-indigo-500',
      delivered: 'bg-emerald-500',
      finished: 'bg-emerald-500',
      cancelled: 'bg-red-500',
    };
    return statusMap[status] || 'bg-gray-400';
  }

  getStatusIconBg(status: string): string {
    const bgMap: Record<string, string> = {
      pending: 'bg-yellow-100',
      processing: 'bg-blue-100',
      shipped: 'bg-indigo-100',
      delivered: 'bg-emerald-100',
      finished: 'bg-emerald-100',
      cancelled: 'bg-red-100',
    };
    return bgMap[status] || 'bg-gray-100';
  }

  getStatusIconColor(status: string): string {
    const colorMap: Record<string, string> = {
      pending: 'text-yellow-600',
      processing: 'text-blue-600',
      shipped: 'text-indigo-600',
      delivered: 'text-emerald-600',
      finished: 'text-emerald-600',
      cancelled: 'text-red-600',
    };
    return colorMap[status] || 'text-gray-600';
  }

  formatRelativeTime(timestamp: Date): string {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return 'Hace ' + diffMins + ' min';
    if (diffHours < 24) return 'Hace ' + diffHours + 'h';
    if (diffDays < 7) return 'Hace ' + diffDays + 'd';
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  getStatusBadgeClass(status: string): string {
    const classMap: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-indigo-100 text-indigo-800',
      delivered: 'bg-emerald-100 text-emerald-800',
      finished: 'bg-emerald-100 text-emerald-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return classMap[status] || 'bg-gray-100 text-gray-800';
  }

  getStatusLabel(status: string): string {
    const labelMap: Record<string, string> = {
      pending: 'Pendiente',
      processing: 'Procesando',
      shipped: 'Enviado',
      delivered: 'Entregado',
      finished: 'Completado',
      cancelled: 'Cancelado',
    };
    return labelMap[status] || status;
  }

  formatAmount(amount: number): string {
    return amount.toFixed(2);
  }

  getProgressPercent(status: string): number {
    const progressMap: Record<string, number> = {
      created: 10,
      pending: 20,
      processing: 50,
      shipped: 75,
      delivered: 90,
      finished: 100,
      cancelled: 0,
    };
    return progressMap[status] || 0;
  }

  getProgressBarClass(status: string): string {
    const classMap: Record<string, string> = {
      pending: 'bg-yellow-500',
      processing: 'bg-blue-500',
      shipped: 'bg-indigo-500',
      delivered: 'bg-emerald-500',
      finished: 'bg-emerald-500',
      cancelled: 'bg-red-500',
    };
    return classMap[status] || 'bg-gray-400';
  }

  getStatusIcon(status: string): string {
    const iconMap: Record<string, string> = {
      pending: 'clock',
      processing: 'refresh-cw',
      shipped: 'truck',
      delivered: 'check-circle',
      finished: 'check-circle',
      cancelled: 'x-circle',
    };
    return iconMap[status] || 'package';
  }

  formatCurrency(amount: number): string {
    return '$' + amount.toFixed(2);
  }

  viewOrder(orderId: string): void {
    this.router.navigate(['/admin/orders/sales', orderId]);
  }

  viewAllOrders(): void {
    this.router.navigate(['/admin/orders/sales']);
  }
}
