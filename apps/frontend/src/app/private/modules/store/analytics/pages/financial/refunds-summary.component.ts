import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { RefundsSummary, AnalyticsService } from '../../services/analytics.service';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-refunds-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="pb-6">
      <!-- Stats Cards -->
      @if (loading()) {
        <div class="stats-container">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else if (data()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total Reembolsado"
            [value]="data()?.total_refunds | currency"
            smallText="Monto total reembolsado"
            iconName="rotate-ccw"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>

          <app-stats
            title="Subtotal Reembolsado"
            [value]="data()?.subtotal_refunds | currency"
            smallText="Valor de productos"
            iconName="shopping-bag"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>

          <app-stats
            title="Impuesto Reembolsado"
            [value]="data()?.tax_refunds | currency"
            smallText="IVA возвращен"
            iconName="percent"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Envío Reembolsado"
            [value]="data()?.shipping_refunds | currency"
            smallText="Costo de envío"
            iconName="truck"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
        </div>
      }

      <!-- Filter Bar -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="rotate-ccw" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Resumen de Reembolsos
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Devoluciones y reembolsos procesados
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <vendix-export-button
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [loading]="exporting()"
              (export)="exportReport()"
            ></vendix-export-button>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              title="Filtros"
              triggerLabel="Filtros"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearAllFilters()"
            ></app-options-dropdown>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 md:mt-4">
        <!-- Refunds Breakdown Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Composición de Reembolsos</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Desglose por tipo</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="refundsBreakdownChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>

        <!-- Refunds Distribution Pie -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución de Reembolsos</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Participación por categoría</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="refundsDistributionChartOptions()" size="large" [showLegend]="false"></app-chart>
            }
          </div>
        </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Financiero</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of financialViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class RefundsSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);

  loading = signal(true);
  exporting = signal(false);
  data = signal<RefundsSummary | null>(null);

  refundsBreakdownChartOptions= signal<EChartsOption>({});
  refundsDistributionChartOptions= signal<EChartsOption>({});

  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      defaultValue: getDefaultStartDate(),
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      defaultValue: getDefaultEndDate(),
    },
  ];

  filterValues: FilterValues = {};

  readonly financialViews: AnalyticsView[] = getViewsByCategory('financial');

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService.getRefundsSummary({}).subscribe({
      next: (response) => {
        if (response?.data) {
          this.data.set(response.data);
        }
        this.updateCharts();
        this.loading.set(false);
      },
      error: () => {
        this.updateCharts();
        this.loading.set(false);
      },
    });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.loadData();
  }

  onClearAllFilters(): void {
    this.filterValues = {};
    this.loadData();
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService.exportFinancialAnalytics({}).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reembolsos_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => {
        this.exporting.set(false);
      },
    });
  }

  private updateCharts(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const d = this.data();
    const refundCats = ['Subtotal', 'Impuesto', 'Envío'];
    const refundValues = [d?.subtotal_refunds || 0, d?.tax_refunds || 0, d?.shipping_refunds || 0];
    const refundColors = ['#f97316', '#f59e0b', '#3b82f6'];

    this.refundsBreakdownChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            if (p.value != null) html += `${p.marker} ${p.seriesName}: <b>${this.currencyService.format(p.value)}</b><br/>`;
          }
          return html;
        },
      },
      legend: {
        data: refundCats,
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
        type: 'category',
        data: refundCats,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.format(Math.round(v), 0),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: refundCats.map((cat: string, i: number) => ({
        name: cat,
        type: 'bar' as const,
        data: refundCats.map((_: string, j: number) => j === i ? refundValues[i] : null),
        itemStyle: { color: refundColors[i] },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: refundColors[i] + '40' },
              { offset: 1, color: refundColors[i] + '05' },
            ],
          },
        },
      })),
    });

    // Refunds Distribution Horizontal Bar
    const distCats = ['Subtotal', 'Impuesto', 'Envío'];
    const distValues = [d?.subtotal_refunds || 0, d?.tax_refunds || 0, d?.shipping_refunds || 0];
    const distColors = ['#f97316', '#f59e0b', '#3b82f6'];

    this.refundsDistributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            if (p.value != null) html += `${p.marker} ${p.seriesName}: <b>${this.currencyService.format(p.value)}</b><br/>`;
          }
          return html;
        },
      },
      legend: {
        data: distCats,
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '10%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        data: distCats,
        axisLabel: { color: textSecondary },
      },
      series: distCats.map((cat: string, i: number) => ({
        name: cat,
        type: 'bar' as const,
        data: distCats.map((_: string, j: number) => j === i ? distValues[i] : null),
        itemStyle: { color: distColors[i] },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: distColors[i] + '40' },
              { offset: 1, color: distColors[i] + '05' },
            ],
          },
        },
      })),
    });
  }
}