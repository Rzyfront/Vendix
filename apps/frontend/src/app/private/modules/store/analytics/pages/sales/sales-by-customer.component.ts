import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
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

@Component({
  selector: 'vendix-sales-by-customer',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Header -->
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <a routerLink="/admin/reports" class="hover:text-primary"
              >Reportes</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <a routerLink="/admin/reports/sales" class="hover:text-primary"
              >Ventas</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Por Cliente</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">
            Ventas por Cliente
          </h1>
          <p class="text-text-secondary mt-1">
            Top clientes por volumen de compras
          </p>
        </div>
        <div
          class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Main Content -->
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
          @if (!loading() && topCustomersChartOptions()) {
          <app-chart
            [options]="topCustomersChartOptions()"
            size="large"
            [showLegend]="true"
          ></app-chart>
          }
        </div>
      </app-card>

      <!-- Main Content Card -->
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
    </div>
  `})
export class SalesByCustomerComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  loading = signal(true);
  exporting = signal(false);
  data = signal<SalesByCustomer[]>([]);
  topCustomersChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

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
          this.data.set(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
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
    if (!data.length) return;

    const top10 = [...data]
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 10)
      .reverse();

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const primaryColor = '#3b82f6';

    this.topCustomersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          const customer = top10.find((c) => c.total_spent === p.value);
          return `${p.name}<br/>Total: ${this.currencyService.format(p.value)}<br/>Órdenes: ${customer?.total_orders || 0}`;
        },
      },
      legend: {
        data: ['Top Clientes'],
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
        data: top10.map((c) => c.customer_name.length > 20 ? c.customer_name.substring(0, 20) + '...' : c.customer_name),
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      series: [
        {
          name: 'Top Clientes',
          type: 'line',
          data: top10.map((p) => p.total_spent),
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

}
