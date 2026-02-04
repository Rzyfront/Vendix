import { Component, OnInit, OnDestroy, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { EChartsOption } from 'echarts';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { TableComponent, TableColumn, TableAction } from '../../../../../shared/components/table/table.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../analytics/services/analytics.service';
import { InventorySummary, StockLevelReport, StockMovementReport } from '../../analytics/interfaces/inventory-analytics.interface';
import { DashboardTabsComponent, DashboardTab } from './dashboard-tabs.component';

@Component({
  selector: 'app-dashboard-inventory',
  standalone: true,
  imports: [CommonModule, StatsComponent, ChartComponent, IconComponent, TableComponent, DashboardTabsComponent],
  template: `
    <div class="space-y-4">
      <!-- Stats Cards - Sticky on mobile -->
      @if (loading()) {
        <div class="stats-container !mb-0 md:!mb-8 ">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface rounded-xl p-4 animate-pulse shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <div class="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div class="h-7 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container !mb-0 md:!mb-8 ">
          <app-stats
            title="Total SKUs"
            [value]="summary()?.total_sku_count || 0"
            iconName="package"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-500"
          ></app-stats>

          <app-stats
            title="Valor Inv."
            [value]="formatCurrency(summary()?.total_stock_value || 0)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-500"
          ></app-stats>

          <app-stats
            title="Bajo Stock"
            [value]="summary()?.low_stock_count || 0"
            [smallText]="getLowStockPercentage()"
            iconName="alert-triangle"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-500"
          ></app-stats>

          <app-stats
            title="Sin Stock"
            [value]="summary()?.out_of_stock_count || 0"
            [smallText]="getOutOfStockPercentage()"
            iconName="x-circle"
            iconBgColor="bg-red-100"
            iconColor="text-red-500"
          ></app-stats>
        </div>
      }

      <!-- Tab Navigation (after stats) -->
      <app-dashboard-tabs
        [tabs]="tabs()"
        [activeTab]="activeTab()"
        (tabChange)="tabChange.emit($event)"
      ></app-dashboard-tabs>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Stock Status Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Estado del Inventario</h3>
            <p class="text-xs text-text-secondary">Distribución por estado</p>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="stockStatusChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>

        <!-- Recent Movements -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border flex justify-between items-center">
            <div>
              <h3 class="font-semibold text-text-primary text-sm">Movimientos Recientes</h3>
              <p class="text-xs text-text-secondary">Últimos ajustes</p>
            </div>
            <button class="text-xs text-primary hover:text-primary/80 font-medium" (click)="goToMovementsReport()">
              Ver más →
            </button>
          </div>
          <div class="p-4">
            @if (loadingMovements()) {
              <div class="h-40 flex items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            } @else if (recentMovements().length === 0) {
              <div class="h-40 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="activity" [size]="36" class="mb-2 opacity-30"></app-icon>
                <p class="text-sm">No hay movimientos</p>
              </div>
            } @else {
              <div class="space-y-2">
                @for (movement of recentMovements().slice(0, 5); track movement.id) {
                  <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <div class="w-7 h-7 rounded-full flex items-center justify-center" [ngClass]="getMovementIconBg(movement.movement_type)">
                      <app-icon [name]="getMovementIcon(movement.movement_type)" [size]="12" [ngClass]="getMovementIconColor(movement.movement_type)"></app-icon>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 truncate">{{ movement.product_name }}</p>
                      <p class="text-xs text-gray-500">{{ getMovementLabel(movement.movement_type) }} • {{ formatMovementDate(movement.date) }}</p>
                    </div>
                    <span class="text-sm font-semibold" [ngClass]="movement.movement_type === 'in' ? 'text-emerald-600' : 'text-red-600'">
                      {{ movement.movement_type === 'in' ? '+' : '-' }}{{ movement.quantity }}
                    </span>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Low Stock Table -->
      <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
        <div class="p-4 border-b border-border flex justify-between items-center">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
              <app-icon name="alert-triangle" [size]="14" class="text-amber-600"></app-icon>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary text-sm">Productos Bajo Stock</h3>
            </div>
          </div>
          <button class="text-xs text-primary hover:text-primary/80 font-medium" (click)="goToLowStockReport()">
            Ver todos →
          </button>
        </div>
        <div class="p-4">
          @if (loadingLowStock()) {
            <div class="h-32 flex items-center justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          } @else if (lowStockProducts().length === 0) {
            <div class="py-6 text-center">
              <div class="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <app-icon name="check-circle" [size]="20" class="text-emerald-600"></app-icon>
              </div>
              <p class="text-sm font-medium text-gray-700">Inventario OK</p>
              <p class="text-xs text-gray-500">Sin productos con bajo stock</p>
            </div>
          } @else {
            <app-table
              [data]="lowStockProducts().slice(0, 5)"
              [columns]="lowStockColumns"
              [actions]="lowStockActions"
              [hoverable]="true"
              size="sm"
            ></app-table>
          }
        </div>
      </div>
    </div>
  `,
})
export class DashboardInventoryComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  storeId = input.required<string>();
  tabs = input.required<DashboardTab[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  loading = signal(true);
  loadingLowStock = signal(true);
  loadingMovements = signal(true);

  summary = signal<InventorySummary | null>(null);
  lowStockProducts = signal<StockLevelReport[]>([]);
  recentMovements = signal<StockMovementReport[]>([]);

  stockStatusChartOptions = signal<EChartsOption>({});

  lowStockColumns: TableColumn[] = [
    { key: 'product_name', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity_on_hand', label: 'Stock', align: 'right' },
    { key: 'reorder_point', label: 'Reorden', align: 'right' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'custom', colorMap: { low_stock: '#f59e0b', out_of_stock: '#ef4444', in_stock: '#10b981' } },
      transform: (v) => this.getStockStatusLabel(v),
    },
  ];

  lowStockActions: TableAction[] = [
    { label: 'Ver', icon: 'eye', action: (item) => this.viewProduct(item.product_id), variant: 'ghost' },
  ];

  ngOnInit(): void {
    this.loadAllData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAllData(): void {
    this.analyticsService.getInventorySummary({}).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.summary.set(response.data);
        this.updateStockStatusChart(response.data);
        this.loading.set(false);
      },
      error: () => {
        this.toastService.error('Error al cargar inventario');
        this.loading.set(false);
      },
    });

    this.analyticsService.getLowStockAlerts({ limit: 10 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.lowStockProducts.set(response.data);
        this.loadingLowStock.set(false);
      },
      error: () => this.loadingLowStock.set(false),
    });

    this.analyticsService.getStockMovements({ limit: 10 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.recentMovements.set(response.data);
        this.loadingMovements.set(false);
      },
      error: () => this.loadingMovements.set(false),
    });
  }

  private updateStockStatusChart(summary: InventorySummary): void {
    const totalSku = summary.total_sku_count || 1;
    const inStock = totalSku - (summary.low_stock_count || 0) - (summary.out_of_stock_count || 0);

    this.stockStatusChartOptions.set({
      tooltip: { trigger: 'item', formatter: (params: any) => `<strong>${params.name}</strong><br/>${params.value} productos<br/>${params.percent.toFixed(1)}%` },
      legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#6b7280', fontSize: 11 } },
      series: [{
        name: 'Estado',
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['35%', '50%'],
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
        labelLine: { show: false },
        data: [
          { value: inStock, name: 'En Stock', itemStyle: { color: '#10b981' } },
          { value: summary.low_stock_count || 0, name: 'Bajo Stock', itemStyle: { color: '#f59e0b' } },
          { value: summary.out_of_stock_count || 0, name: 'Sin Stock', itemStyle: { color: '#ef4444' } },
        ],
      }],
    });
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value.toFixed(0);
  }

  getLowStockPercentage(): string {
    const s = this.summary();
    if (!s?.total_sku_count) return '';
    return `${((s.low_stock_count || 0) / s.total_sku_count * 100).toFixed(1)}% inv.`;
  }

  getOutOfStockPercentage(): string {
    const s = this.summary();
    if (!s?.total_sku_count) return '';
    return `${((s.out_of_stock_count || 0) / s.total_sku_count * 100).toFixed(1)}% inv.`;
  }

  getStockStatusLabel(status: string): string {
    return { in_stock: 'OK', low_stock: 'Bajo', out_of_stock: 'Sin Stock' }[status] || status;
  }

  getMovementIconBg(type: string): string {
    return { in: 'bg-emerald-100', out: 'bg-red-100', transfer: 'bg-blue-100', adjustment: 'bg-purple-100' }[type] || 'bg-gray-100';
  }

  getMovementIconColor(type: string): string {
    return { in: 'text-emerald-600', out: 'text-red-600', transfer: 'text-blue-600', adjustment: 'text-purple-600' }[type] || 'text-gray-600';
  }

  getMovementIcon(type: string): string {
    return { in: 'arrow-down', out: 'arrow-up', transfer: 'arrow-right-left', adjustment: 'edit-3' }[type] || 'activity';
  }

  getMovementLabel(type: string): string {
    return { in: 'Entrada', out: 'Salida', transfer: 'Transfer', adjustment: 'Ajuste' }[type] || type;
  }

  formatMovementDate(date: string): string {
    return new Date(date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }

  viewProduct(productId: number): void {
    this.router.navigate(['/admin/products', productId]);
  }

  goToLowStockReport(): void {
    this.router.navigate(['/admin/reports/inventory/low-stock']);
  }

  goToMovementsReport(): void {
    this.router.navigate(['/admin/reports/inventory/movements']);
  }
}
