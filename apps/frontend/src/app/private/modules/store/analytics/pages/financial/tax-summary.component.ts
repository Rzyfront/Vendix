import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { TaxSummary, AnalyticsService } from '../../services/analytics.service';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-tax-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
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
            title="Impuestos Cobrados"
            [value]="data()?.tax_collected | currency"
            smallText="Total recaudado"
            iconName="plus-circle"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Impuestos Devueltos"
            [value]="data()?.tax_refunded | currency"
            smallText="Por reembolsos"
            iconName="minus-circle"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>

          <app-stats
            title="Impuesto Neto"
            [value]="data()?.net_tax | currency"
            smallText="Después de devoluciones"
            iconName="calculator"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Tasa Efectiva"
            [value]="data()?.effective_rate || 0"
            valueUnit="%"
            smallText="Porcentaje sobre ingresos"
            iconName="percent"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>
        </div>
      }

      <!-- Filter Bar -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-0.5 md:static md:bg-transparent md:px-6 md:py-1.5 md:border-b md:border-border"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-base md:font-semibold md:text-text-primary truncate">
              Resumen de Impuestos
            </h2>
            <p class="text-[11px] text-gray-400 md:text-xs md:text-text-secondary truncate">
              Desglose de impuestos recaudados y pagados
            </p>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
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
      </div>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 md:mt-4">
        <!-- Tax Breakdown Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Impuestos Cobrados vs Devueltos</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Comparativa de taxes</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              @defer (on viewport) {
                <app-chart [options]="taxComparisonChartOptions" size="large" [showLegend]="false"></app-chart>
              } @placeholder {
                <div class="h-64 bg-surface-secondary animate-pulse rounded-xl"></div>
              }
            }
          </div>
        </app-card>

        <!-- Effective Rate Gauge -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Tasa Efectiva</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Porcentaje de impuestos sobre ingresos</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              @defer (on viewport) {
                <app-chart [options]="effectiveRateChartOptions" size="large" [showLegend]="false"></app-chart>
              } @placeholder {
                <div class="h-64 bg-surface-secondary animate-pulse rounded-xl"></div>
              }
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
export class TaxSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);

  loading = signal(true);
  exporting = signal(false);
  data = signal<TaxSummary | null>(null);

  taxComparisonChartOptions: EChartsOption = {};
  effectiveRateChartOptions: EChartsOption = {};

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

    this.analyticsService.getTaxSummary({}).subscribe({
      next: (response) => {
        if (response?.data) {
          this.data.set(response.data);
          this.updateCharts();
        }
        this.loading.set(false);
      },
      error: () => {
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
        a.download = `impuestos_${new Date().toISOString().split('T')[0]}.csv`;
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
    if (!d) return;

    // Tax Comparison Bar Chart
    this.taxComparisonChartOptions = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          return `${params[0].name}: <b>${this.currencyService.format(params[0].value)}</b>`;
        },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '3%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: ['Cobrados', 'Devueltos', 'Neto'],
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.format(v, 0),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          type: 'bar',
          data: [
            { value: d.tax_collected || 0, itemStyle: { color: '#22c55e' } },
            { value: -(d.tax_refunded || 0), itemStyle: { color: '#ef4444' } },
            { value: d.net_tax || 0, itemStyle: { color: '#3b82f6' } },
          ],
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 60,
        },
      ],
    };

    // Effective Rate Gauge
    const rate = Math.min((d.effective_rate || 0), 30);
    this.effectiveRateChartOptions = {
      series: [
        {
          type: 'gauge',
          center: ['50%', '60%'],
          radius: '80%',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 30,
          splitNumber: 3,
          pointer: {
            show: true,
            length: '60%',
            width: 6,
            itemStyle: { color: 'auto' },
          },
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                [0.33, '#22c55e'],
                [0.66, '#f59e0b'],
                [1, '#ef4444'],
              ],
            },
          },
          axisTick: { show: false },
          splitLine: {
            length: 12,
            lineStyle: { width: 2, color: '#999' },
          },
          axisLabel: {
            distance: 25,
            fontSize: 11,
            formatter: (value: number) => `${value}%`,
          },
          detail: {
            valueAnimation: true,
            formatter: (value: number) => `${value.toFixed(1)}%`,
            fontSize: 20,
            fontWeight: 'bold',
            offsetCenter: [0, '20%'],
            color: rate < 10 ? '#22c55e' : rate < 20 ? '#f59e0b' : '#ef4444',
          },
          data: [{ value: rate }],
        },
      ],
    };
  }
}