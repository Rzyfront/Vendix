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
import {
  getDefaultStartDate,
  getDefaultEndDate} from '../../../../../../shared/utils/date.util';
import {
  SalesByPaymentMethod,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-by-payment',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
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
            <span>Por Método de Pago</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">
            Ventas por Método de Pago
          </h1>
          <p class="text-text-secondary mt-1">
            Distribución de ventas por forma de pago
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

      <!-- Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Pie Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Distribución por Método</span
            >
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div
                  class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
                ></div>
              </div>
            } @else {
              @defer (on viewport) {
                <app-chart [options]="chartOptions()" size="large"></app-chart>
              } @placeholder {
                <div
                  class="h-64 bg-surface-secondary animate-pulse rounded-xl"
                ></div>
              }
            }
          </div>
        </app-card>

        <!-- Table -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Detalle por Método</span
            >
          </div>
          <div class="p-4">
            <app-responsive-data-view
              [data]="data()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              emptyMessage="No hay datos"
              emptyIcon="credit-card"
            ></app-responsive-data-view>
          </div>
        </app-card>
      </div>
    </div>
  `})
export class SalesByPaymentComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
loading = signal(true);
  exporting = signal(false);
  data = signal<SalesByPaymentMethod[]>([]);
  chartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  columns: TableColumn[] = [
    { key: 'display_name', label: 'Método', sortable: true, priority: 1 },
    {
      key: 'transaction_count',
      label: 'Transacciones',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '120px'},
    {
      key: 'total_amount',
      label: 'Monto Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val)},
    {
      key: 'percentage',
      label: '% del Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
      transform: (val) => `${val.toFixed(1)}%`},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    detailKeys: [
      {
        key: 'total_amount',
        label: 'Monto',
        transform: (val: any) => this.formatCurrency(val)},
      {
        key: 'percentage',
        label: 'Porcentaje',
        transform: (val: any) => `${val.toFixed(1)}%`},
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
      date_range: this.dateRange()};

    this.analyticsService
      .getSalesByPaymentMethod(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar datos');
          this.loading.set(false);
        }});
  }

  private updateChart(data: SalesByPaymentMethod[]): void {
    const categories = data.map((item) => item.display_name);
    const values = data.map((item) => item.total_amount);
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            if (p.value != null) html += `${p.marker} ${p.seriesName}: <b>${this.formatCurrency(p.value)}</b><br/>`;
          }
          return html;
        }},
      legend: {
        data: ['Ventas'],
        bottom: 30,
        textStyle: { color: '#6b7280' },
      },
      grid: { left: '3%', right: '4%', bottom: '25%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          formatter: (v: number) => this.formatCurrency(v),
        },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [{
          name: 'Ventas',
          type: 'line',
          data: values,
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: 10,
          showSymbol: true,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 3 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f640' },
                { offset: 1, color: '#3b82f605' },
              ],
            },
          },
        }],
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
          a.download = `ventas_metodo_pago_${new Date().toISOString().split('T')[0]}.csv`;
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
}
