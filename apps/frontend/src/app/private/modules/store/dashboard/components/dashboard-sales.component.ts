import { Component, OnInit, OnDestroy, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { EChartsOption } from 'echarts';

import { ChartComponent } from '../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { TableComponent, TableColumn } from '../../../../../shared/components/table/table.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { DashboardTabsComponent, DashboardTab } from './dashboard-tabs.component';

import { AnalyticsService } from '../../analytics/services/analytics.service';
import {
  SalesByProduct,
  SalesByCategory,
  SalesByChannel,
  SalesAnalyticsQueryDto,
} from '../../analytics/interfaces/sales-analytics.interface';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';

const CHANNEL_COLORS: Record<string, string> = {
  ecommerce: '#3b82f6',
  pos: '#22c55e',
  whatsapp: '#25D366',
  agent: '#8b5cf6',
  marketplace: '#f59e0b',
  default: '#6b7280',
};

@Component({
  selector: 'app-dashboard-sales',
  standalone: true,
  imports: [CommonModule, ChartComponent, IconComponent, TableComponent, DashboardTabsComponent],
  template: `
    <div class="space-y-4">
      <!-- Quick Stats Cards - Sticky on mobile -->
      <div class="stats-container !mb-0 md:!mb-8 ">
        <div class="bg-surface rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)] min-w-[140px] flex-shrink-0 sm:flex-shrink sm:min-w-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
              <app-icon name="package" [size]="18" class="text-blue-500"></app-icon>
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-text-secondary uppercase tracking-wide">Productos</p>
              <p class="text-lg font-bold text-text-primary">{{ totalProductsSold() }}</p>
            </div>
          </div>
        </div>

        <div class="bg-surface rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)] min-w-[140px] flex-shrink-0 sm:flex-shrink sm:min-w-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center">
              <app-icon name="trending-up" [size]="18" class="text-emerald-500"></app-icon>
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-text-secondary uppercase tracking-wide">Top Producto</p>
              <p class="text-sm font-bold text-text-primary truncate" [title]="topProductName()">
                {{ topProductName() || 'N/A' }}
              </p>
            </div>
          </div>
        </div>

        <div class="bg-surface rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)] min-w-[140px] flex-shrink-0 sm:flex-shrink sm:min-w-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
              <app-icon name="shopping-bag" [size]="18" class="text-purple-500"></app-icon>
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-text-secondary uppercase tracking-wide">Top Canal</p>
              <p class="text-sm font-bold text-text-primary">{{ topChannel() || 'N/A' }}</p>
            </div>
          </div>
        </div>

        <div class="bg-surface rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)] min-w-[140px] flex-shrink-0 sm:flex-shrink sm:min-w-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <app-icon name="folder" [size]="18" class="text-amber-500"></app-icon>
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-text-secondary uppercase tracking-wide">Top Categoría</p>
              <p class="text-sm font-bold text-text-primary truncate" [title]="topCategoryName()">
                {{ topCategoryName() || 'N/A' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Navigation (after stats) -->
      <app-dashboard-tabs
        [tabs]="tabs()"
        [activeTab]="activeTab()"
        (tabChange)="tabChange.emit($event)"
      ></app-dashboard-tabs>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Top Products Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border flex justify-between items-center">
            <div>
              <h3 class="font-semibold text-text-primary text-sm">Top 10 Productos</h3>
              <p class="text-xs text-text-secondary">Por ingresos</p>
            </div>
            <button
              class="text-xs text-primary hover:text-primary/80 font-medium"
              (click)="goToProductReport()"
            >
              Ver más →
            </button>
          </div>
          <div class="p-4">
            @if (loadingProducts()) {
              <div class="h-72 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (topProducts().length === 0) {
              <div class="h-72 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="package" [size]="40" class="mb-2 opacity-30"></app-icon>
                <p class="text-sm">No hay datos de productos</p>
              </div>
            } @else {
              <app-chart [options]="topProductsChartOptions()" size="large" className="!min-h-[280px]"></app-chart>
            }
          </div>
        </div>

        <!-- Sales Channels Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Canales de Venta</h3>
            <p class="text-xs text-text-secondary">Distribución del mes</p>
          </div>
          <div class="p-4">
            @if (loadingChannels()) {
              <div class="h-72 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (salesChannels().length === 0) {
              <div class="h-72 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="shopping-bag" [size]="40" class="mb-2 opacity-30"></app-icon>
                <p class="text-sm">No hay datos de canales</p>
              </div>
            } @else {
              <app-chart [options]="channelsChartOptions()" size="large" className="!min-h-[280px]"></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Sales by Category Table -->
      <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
        <div class="p-4 border-b border-border flex justify-between items-center">
          <div>
            <h3 class="font-semibold text-text-primary text-sm">Ventas por Categoría</h3>
            <p class="text-xs text-text-secondary">Desglose por categoría</p>
          </div>
          <button
            class="text-xs text-primary hover:text-primary/80 font-medium"
            (click)="goToCategoryReport()"
          >
            Ver más →
          </button>
        </div>
        <div class="p-4">
          @if (loadingCategories()) {
            <div class="h-32 flex items-center justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          } @else if (categories().length === 0) {
            <div class="py-6 text-center text-text-secondary">
              <app-icon name="folder" [size]="36" class="mx-auto mb-2 opacity-30"></app-icon>
              <p class="text-sm">No hay datos de categorías</p>
            </div>
          } @else {
            <app-table
              [data]="categories()"
              [columns]="categoryColumns"
              [hoverable]="true"
              size="sm"
            ></app-table>
          }
        </div>
      </div>
    </div>
  `,
})
export class DashboardSalesComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  storeId = input.required<string>();
  tabs = input.required<DashboardTab[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  loadingProducts = signal(true);
  loadingChannels = signal(true);
  loadingCategories = signal(true);

  topProducts = signal<SalesByProduct[]>([]);
  salesChannels = signal<SalesByChannel[]>([]);
  categories = signal<SalesByCategory[]>([]);

  topProductsChartOptions = signal<EChartsOption>({});
  channelsChartOptions = signal<EChartsOption>({});

  totalProductsSold = signal(0);
  topProductName = signal('');
  topChannel = signal('');
  topCategoryName = signal('');

  categoryColumns: TableColumn[] = [
    { key: 'category_name', label: 'Categoría', sortable: true },
    { key: 'units_sold', label: 'Unidades', align: 'right', transform: (v) => v.toLocaleString() },
    { key: 'revenue', label: 'Ingresos', align: 'right', transform: (v) => this.formatCurrency(v) },
    { key: 'percentage_of_total', label: '%', align: 'right', transform: (v) => `${v.toFixed(1)}%` },
  ];

  private dateRange: DateRangeFilter = {
    start_date: this.getMonthStartDate(),
    end_date: this.getMonthEndDate(),
    preset: 'thisMonth',
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadAllData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAllData(): void {
    const query: SalesAnalyticsQueryDto = { date_range: this.dateRange, limit: 10 };

    this.analyticsService
      .getSalesByProduct(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          const products = response.data.slice(0, 10);
          this.topProducts.set(products);
          this.updateTopProductsChart(products);
          const total = products.reduce((sum, p) => sum + p.units_sold, 0);
          this.totalProductsSold.set(total);
          if (products.length > 0) this.topProductName.set(products[0].product_name);
          this.loadingProducts.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar productos');
          this.loadingProducts.set(false);
        },
      });

    this.analyticsService
      .getSalesByChannel({ date_range: this.dateRange })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.salesChannels.set(response.data);
          this.updateChannelsChart(response.data);
          if (response.data.length > 0) {
            const sorted = [...response.data].sort((a, b) => b.revenue - a.revenue);
            this.topChannel.set(sorted[0].display_name || sorted[0].channel);
          }
          this.loadingChannels.set(false);
        },
        error: () => this.loadingChannels.set(false),
      });

    this.analyticsService
      .getSalesByCategory({ date_range: this.dateRange })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.categories.set(response.data);
          if (response.data.length > 0) {
            const sorted = [...response.data].sort((a, b) => b.revenue - a.revenue);
            this.topCategoryName.set(sorted[0].category_name);
          }
          this.loadingCategories.set(false);
        },
        error: () => this.loadingCategories.set(false),
      });
  }

  private updateTopProductsChart(products: SalesByProduct[]): void {
    if (!products.length) return;
    const sortedProducts = [...products].sort((a, b) => a.revenue - b.revenue);

    this.topProductsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          const product = sortedProducts[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Ingresos: ${this.formatCurrency(product.revenue)}<br/>Unidades: ${product.units_sold.toLocaleString()}`;
        },
      },
      grid: { left: '3%', right: '12%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 10, formatter: (value: number) => value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value}` },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      yAxis: {
        type: 'category',
        data: sortedProducts.map((p) => p.product_name.length > 18 ? p.product_name.slice(0, 18) + '...' : p.product_name),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#374151', fontSize: 10 },
      },
      series: [{
        name: 'Ingresos',
        type: 'bar',
        data: sortedProducts.map((p) => p.revenue),
        itemStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#60a5fa' }] },
          borderRadius: [0, 4, 4, 0],
        },
        barMaxWidth: 20,
        label: { show: true, position: 'right', formatter: (params: any) => this.formatCompactCurrency(params.value), color: '#6b7280', fontSize: 10 },
      }],
    });
  }

  private updateChannelsChart(channels: SalesByChannel[]): void {
    if (!channels.length) return;
    const colors = channels.map((c) => CHANNEL_COLORS[c.channel.toLowerCase()] || CHANNEL_COLORS['default']);

    this.channelsChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `<strong>${params.name}</strong><br/>
           Ingresos: ${this.formatCurrency(params.value)}<br/>
           Órdenes: ${channels[params.dataIndex]?.order_count || 0}<br/>
           ${params.percent.toFixed(1)}%`,
      },
      legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#6b7280', fontSize: 11 } },
      series: [{
        name: 'Canales de Venta',
        type: 'pie',
        radius: ['35%', '60%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
        labelLine: { show: false },
        data: channels.map((c, i) => ({ value: c.revenue, name: c.display_name || c.channel, itemStyle: { color: colors[i] } })),
      }],
    });
  }

  formatCurrency(value: number): string {
    const currency = this.currencyService.currentCurrency();

    // Fallback if currency is not loaded yet
    if (!currency) {
      return this.currencyService.format(value);
    }

    if (value >= 1000000) {
      const numValue = (value / 1000000).toFixed(1);
      if (currency.position === 'before') {
        return `${currency.symbol}${numValue}M`;
      } else {
        return `${numValue}M${currency.symbol}`;
      }
    }
    if (value >= 1000) {
      const numValue = (value / 1000).toFixed(1);
      if (currency.position === 'before') {
        return `${currency.symbol}${numValue}K`;
      } else {
        return `${numValue}K${currency.symbol}`;
      }
    }

    if (currency.position === 'before') {
      return `${currency.symbol}${Math.round(value).toLocaleString()}`;
    } else {
      return `${Math.round(value).toLocaleString()}${currency.symbol}`;
    }
  }

  formatCompactCurrency(value: number): string {
    const currency = this.currencyService.currentCurrency();

    // Fallback if currency is not loaded yet
    if (!currency) {
      return this.currencyService.format(value);
    }

    if (value >= 1000000) {
      const numValue = (value / 1000000).toFixed(1);
      if (currency.position === 'before') {
        return `${currency.symbol}${numValue}M`;
      } else {
        return `${numValue}M${currency.symbol}`;
      }
    }
    if (value >= 1000) {
      const numValue = (value / 1000).toFixed(0);
      if (currency.position === 'before') {
        return `${currency.symbol}${numValue}K`;
      } else {
        return `${numValue}K${currency.symbol}`;
      }
    }

    return this.currencyService.format(value);
  }

  goToProductReport(): void {
    this.router.navigate(['/admin/reports/sales/by-product']);
  }

  goToCategoryReport(): void {
    this.router.navigate(['/admin/reports/sales/by-category']);
  }

  private getMonthStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getMonthEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
