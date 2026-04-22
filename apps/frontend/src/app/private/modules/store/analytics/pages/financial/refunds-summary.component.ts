import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
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
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-0.5 md:static md:bg-transparent md:px-6 md:py-1.5 md:border-b md:border-border"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-base md:font-semibold md:text-text-primary truncate">
              Resumen de Reembolsos
            </h2>
            <p class="text-[11px] text-gray-400 md:text-xs md:text-text-secondary truncate">
              Devoluciones y reembolsos procesados
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
              @defer (on viewport) {
                <app-chart [options]="refundsBreakdownChartOptions" size="large" [showLegend]="true"></app-chart>
              } @placeholder {
                <div class="h-64 bg-surface-secondary animate-pulse rounded-xl"></div>
              }
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
              @defer (on viewport) {
                <app-chart [options]="refundsDistributionChartOptions" size="large" [showLegend]="false"></app-chart>
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
export class RefundsSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);

  loading = signal(true);
  exporting = signal(false);
  data = signal<RefundsSummary | null>(null);

  refundsBreakdownChartOptions: EChartsOption = {};
  refundsDistributionChartOptions: EChartsOption = {};

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
    if (!d) return;

    // Refunds Breakdown Bar Chart
    this.refundsBreakdownChartOptions = {
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
        data: ['Subtotal', 'Impuesto', 'Envío'],
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
            { value: d.subtotal_refunds || 0, itemStyle: { color: '#f97316' } },
            { value: d.tax_refunds || 0, itemStyle: { color: '#f59e0b' } },
            { value: d.shipping_refunds || 0, itemStyle: { color: '#3b82f6' } },
          ],
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 60,
        },
      ],
    };

    // Refunds Distribution Pie
    this.refundsDistributionChartOptions = {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => `${params.name}: <b>${this.currencyService.format(params.value)}</b> (${params.percent}%)`,
      },
      legend: {
        bottom: 0,
        textStyle: { color: textSecondary },
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold' },
          },
          data: [
            { value: d.subtotal_refunds || 0, name: 'Subtotal', itemStyle: { color: '#f97316' } },
            { value: d.tax_refunds || 0, name: 'Impuesto', itemStyle: { color: '#f59e0b' } },
            { value: d.shipping_refunds || 0, name: 'Envío', itemStyle: { color: '#3b82f6' } },
          ],
        },
      ],
    };
  }
}