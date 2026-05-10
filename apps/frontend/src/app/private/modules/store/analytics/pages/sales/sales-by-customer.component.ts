import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig} from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import {
  SalesByCustomer,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';
import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-sales-by-customer',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Clientes"
          [value]="data().length"
          smallText=" clientes"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Ingresos Total"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Cliente Top"
          [value]="getTopCustomerName()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Ingreso Promedio"
          [value]="getAvgRevenue()"
          smallText="por cliente"
          iconName="bar-chart-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0"
          >
            <app-icon name="users" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Ventas por Cliente
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Top clientes por volumen de compras
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <!-- Toggle Chart/Table -->
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              (click)="activeView.set('chart')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="
                activeView() === 'chart'
                  ? 'bg-black text-white'
                  : 'bg-surface text-text-secondary hover:bg-background'
              "
            >
              <app-icon name="bar-chart-2" [size]="16"></app-icon>
              Gráficas
            </button>
            <button
              (click)="activeView.set('table')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="
                activeView() === 'table'
                  ? 'bg-black text-white'
                  : 'bg-surface text-text-secondary hover:bg-background'
              "
            >
              <app-icon name="table" [size]="16"></app-icon>
              Tabla
            </button>
          </div>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      <!-- Main Content -->
      @if (activeView() === 'chart') {
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Top Clientes
            <span
              class="text-xs text-[var(--color-text-secondary)] font-normal ml-2"
            >
            ({{ data().length }} clientes)
            </span>
          </span>
        </div>

        <div class="p-4">
          @if (loading()) {
            <div class="h-80 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else {
            <app-chart
              [options]="topCustomersChartOptions()"
              size="large"
              [showLegend]="true"
            ></app-chart>
          }
        </div>
      </app-card>
      }

      <!-- Main Content Card -->
      @if (activeView() === 'table') {
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Detalle de Clientes
            <span
              class="text-xs text-[var(--color-text-secondary)] font-normal ml-2"
            >
              ({{ data().length }} clientes)
            </span>
          </span>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay datos de clientes"
            emptyIcon="users"
          ></app-responsive-data-view>
        </div>
      </app-card>
      }
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Ventas</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of salesViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `})
export class SalesByCustomerComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  loading = signal(true);
  exporting = signal(false);
  activeView = signal<'chart' | 'table'>('chart');
  data = signal<SalesByCustomer[]>([]);
  topCustomersChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales').filter(
    (v) => v.key !== 'sales_by_customer'
  );

  columns: TableColumn[] = [
    { key: 'customer_name', label: 'Cliente', sortable: true, priority: 1 },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      priority: 2,
      width: '200px'},
    {
      key: 'total_orders',
      label: 'Órdenes',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px'},
    {
      key: 'total_spent',
      label: 'Total Gastado',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val)},
    {
      key: 'average_order_value',
      label: 'Ticket Prom.',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val)},
    {
      key: 'last_order_date',
      label: 'Última Compra',
      sortable: true,
      align: 'center',
      priority: 2,
      width: '120px',
      transform: (val) =>
        val ? new Date(val).toLocaleDateString('es-CO') : '-'},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'customer_name',
    subtitleKey: 'email',
    detailKeys: [
      {
        key: 'total_orders',
        label: 'Órdenes',
        transform: (val: any) => `${val} órdenes`},
      {
        key: 'total_spent',
        label: 'Total',
        transform: (val: any) => this.formatCurrency(val)},
    ]};

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }
onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: SalesAnalyticsQueryDto = {
      date_range: this.dateRange(),
      limit: 50};

    this.analyticsService
      .getSalesByCustomer(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const customers = Array.isArray(response?.data) ? response.data : [];
          this.data.set(customers);
          this.updateChart(customers);
          this.loading.set(false);
        },
        error: () => {
          this.data.set([]);
          this.updateChart([]);
          this.toastService.error('Error al cargar ventas por cliente');
          this.loading.set(false);
        }});
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ventas_cliente_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value, 0);
  }

  private updateChart(data: SalesByCustomer[]): void {

    const top10 = Array.isArray(data) && data.length > 0
      ? [...data].sort((a, b) => b.total_spent - a.total_spent).slice(0, 10).reverse()
      : [];

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const primaryColor = '#3b82f6';

    this.topCustomersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!params?.[0]) return '';
          const p = params[0];
          const customer = top10.find((c) => c.total_spent === p.value);
          return `${p.name}<br/>Total: ${this.currencyService.format(p.value)}<br/>Órdenes: ${customer?.total_orders || 0}`;
        },
      },
      legend: {
        data: top10.length > 0 ? top10.map((c) => c.customer_name) : ['Sin datos'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '25%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 1000000,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.formatCurrency(Math.round(v)),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'category',
        data: top10.length > 0
          ? top10.map((c) => c.customer_name.length > 20 ? c.customer_name.substring(0, 20) + '...' : c.customer_name)
          : ['Sin datos'],
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      series: top10.length > 0 ? top10.map((c, i) => ({
          name: c.customer_name,
          type: 'bar' as const,
          data: [c.total_spent],
          itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] },
          barMaxWidth: 32,
        })) : [{
          name: 'Sin datos',
          type: 'bar' as const,
          data: [0],
          itemStyle: { color: '#9ca3af' },
          barMaxWidth: 32,
        }],
    });
  }

  getTotalRevenue(): string {
    const total = this.data().reduce((sum, c) => sum + (c.total_spent || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTopCustomerName(): string {
    if (!this.data().length) return '-';
    const top = [...this.data()].sort((a, b) => b.total_spent - a.total_spent)[0];
    return top?.customer_name?.substring(0, 15) || '-';
  }

  getAvgRevenue(): string {
    if (!this.data().length) return '-';
    const total = this.data().reduce((sum, c) => sum + (c.total_spent || 0), 0);
    return this.currencyService.format(total / this.data().length, 0);
  }

}
