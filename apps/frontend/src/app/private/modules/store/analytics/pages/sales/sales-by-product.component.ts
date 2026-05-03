import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  TableColumn,
  TableAction} from '../../../../../../shared/components/table/table.component';
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
  SalesByProduct,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-by-product',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Productos"
          [value]="data().length"
          smallText=" productos en el período"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Unidades Vendidas"
          [value]="getTotalUnits()"
          smallText=" totales"
          iconName="boxes"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Ingresos Totales"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Producto Más Vendido"
          [value]="getTopProductName()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sticky top-[99px] z-10 bg-[#ffffff] px-2 py-0.5 md:static md:bg-transparent md:px-6 md:py-1.5 md:border-b md:border-border"
      >
        <div>
          <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <a routerLink="/admin/analytics" class="hover:text-primary"
              >Analíticas</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <a routerLink="/admin/analytics/sales" class="hover:text-primary"
              >Ventas</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Por Producto</span>
          </div>
          <h1 class="text-xl font-bold text-text-primary">
            Ventas por Producto
          </h1>
          <p class="text-text-secondary mt-1">
            Análisis detallado de ventas por producto
          </p>
        </div>
        <div
          class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
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

      <!-- Chart View -->
      @if (activeView() === 'chart') {
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Productos Vendidos
            <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
              ({{ data().length }} productos)
            </span>
          </span>
        </div>
        <div class="p-4">
          @if (!loading() && topProductsChartOptions()) {
          <app-chart
            [options]="topProductsChartOptions()"
            size="large"
            [showLegend]="true"
          ></app-chart>
          }
        </div>
      </app-card>
      }

      <!-- Table View -->
      @if (activeView() === 'table') {
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Productos Vendidos
            <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
              ({{ data().length }} productos)
            </span>
          </span>
        </div>
        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay datos de ventas por producto"
            emptyIcon="package"
          ></app-responsive-data-view>
        </div>
      </app-card>
      }
    </div>
  `})
export class SalesByProductComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  loading = signal(true);
  exporting = signal(false);
  activeView = signal<'chart' | 'table'>('chart');
  data = signal<SalesByProduct[]>([]);
  topProductsChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  columns: TableColumn[] = [
    {
      key: 'image_url',
      label: '',
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image'},
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '120px' },
    {
      key: 'units_sold',
      label: 'Unidades',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px'},
    {
      key: 'revenue',
      label: 'Ingresos',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val)},
    {
      key: 'average_price',
      label: 'Precio Prom.',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val)},
    {
      key: 'profit_margin',
      label: 'Margen',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '100px',
      transform: (val) => (val ? val.toFixed(1) + '%' : '-')},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarKey: 'image_url',
    detailKeys: [
      {
        key: 'units_sold',
        label: 'Unidades',
        transform: (val: any) => `${val} uds`},
      {
        key: 'revenue',
        label: 'Ingresos',
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
      limit: 100};

    this.analyticsService
      .getSalesByProduct(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar ventas por producto');
          this.loading.set(false);
        }});
  }

  private updateChart(data: SalesByProduct[]): void {
    if (!data.length) return;

    const top10 = [...data]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .reverse();

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const primaryColor = '#3b82f6';

    this.topProductsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Ingresos: ${this.currencyService.format(p.value)}`;
        },
      },
      legend: {
        data: ['Top Productos'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '20%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.formatCurrency(v),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'category',
        data: top10.map((p) => p.product_name.length > 20 ? p.product_name.substring(0, 20) + '...' : p.product_name),
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      series: [
        {
          name: 'Top Productos',
          type: 'line',
          data: top10.map((p) => p.revenue),
          itemStyle: { color: primaryColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: primaryColor + '40' },
                { offset: 1, color: primaryColor },
              ],
            },
          },
        },
      ],
    });
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
          a.download = `ventas_producto_${new Date().toISOString().split('T')[0]}.csv`;
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

  getTotalUnits(): number {
    return this.data().reduce((sum, p) => sum + (p.units_sold || 0), 0);
  }

  getTotalRevenue(): string {
    const total = this.data().reduce((sum, p) => sum + (p.revenue || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTopProductName(): string {
    if (!this.data().length) return '-';
    const top = [...this.data()].sort((a, b) => b.units_sold - a.units_sold)[0];
    return top?.product_name?.substring(0, 15) + (top.product_name.length > 15 ? '...' : '') || '-';
  }

}
