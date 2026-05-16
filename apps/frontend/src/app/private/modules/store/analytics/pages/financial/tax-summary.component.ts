import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { TaxSummary, AnalyticsService } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-tax-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    ExportButtonComponent,
    DateRangeFilterComponent,
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
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0"
          >
            <app-icon name="percent" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h2 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Resumen de Impuestos
            </h2>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Desglose de impuestos recaudados y pagados
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
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
      <div class="grid grid-cols-1 gap-6">
        <!-- Charts Row -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              <app-chart [options]="taxComparisonChartOptions()" size="large" [showLegend]="true"></app-chart>
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
              <app-chart [options]="effectiveRateChartOptions()" size="large" [showLegend]="true"></app-chart>
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

  taxComparisonChartOptions= signal<EChartsOption>({});
  effectiveRateChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly financialViews: AnalyticsView[] = getViewsByCategory('financial');

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService.getTaxSummary({ date_range: this.dateRange() }).subscribe({
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

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService.exportFinancialAnalytics({ date_range: this.dateRange() }).subscribe({
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

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  private updateCharts(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const d = this.data();
    if (!d) return;

    const taxCategories = ['Cobrados', 'Devueltos', 'Neto'];
    const taxValues = [d.tax_collected || 0, d.tax_refunded || 0, d.net_tax || 0];
    const taxColors = ['#22c55e', '#ef4444', '#3b82f6'];

    this.taxComparisonChartOptions.set({
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
        data: ['Impuestos'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        itemHeight: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: taxCategories,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.format(Math.round(v), 0),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [{
        name: 'Impuestos',
        type: 'bar',
        data: taxValues.map((v, i) => ({
          value: v,
          itemStyle: { color: taxColors[i] }
        })),
        barMaxWidth: 50,
      }],
    });

    // Effective Rate Gauge
    const rate = Math.min((d.effective_rate || 0), 30);
    this.effectiveRateChartOptions.set({
      legend: {
        data: ['Tasa Efectiva'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        itemHeight: 14,
        textStyle: { color: textSecondary },
      },
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
    });
  }
}