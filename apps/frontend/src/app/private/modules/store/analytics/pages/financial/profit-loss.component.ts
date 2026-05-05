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
import { ProfitLossSummary, RefundsSummary, AnalyticsService } from '../../services/analytics.service';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-profit-loss',
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
            title="Ingresos Netos"
            [value]="data()?.revenue?.net_revenue | currency"
            smallText="Ingresos después de descuentos"
            iconName="trending-up"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Ganancia Bruta"
            [value]="data()?.costs?.gross_profit | currency"
            [smallText]="(data()?.costs?.gross_margin ?? 0) >= 0 ? '+' + (data()?.costs?.gross_margin | number:'1.1-1') + '% margen' : (data()?.costs?.gross_margin | number:'1.1-1') + '% margen'"
            iconName="percent"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Reembolsos"
            [value]="data()?.refunds?.total_refunds | currency"
            smallText="Total reembolsado"
            iconName="rotate-ccw"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>

          <app-stats
            title="Ganancia Neta"
            [value]="data()?.bottom_line?.net_profit | currency"
            [smallText]="(data()?.bottom_line?.net_margin ?? 0) >= 0 ? '+' + (data()?.bottom_line?.net_margin | number:'1.1-1') + '% margen' : (data()?.bottom_line?.net_margin | number:'1.1-1') + '% margen'"
            iconName="landmark"
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
            <app-icon name="trending-up" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h2 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Estado de Resultados
            </h2>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Ingresos, costos y utilidad neta del período
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <vendix-export-button
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
        <!-- Revenue vs Costs Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Ingresos vs Costos</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Comparativa de ingresos y costos</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="revenueCostsChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>

        <!-- Net Profit Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Resumen del Período</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Detalle de ingresos, costos y ganancias</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="profitSummaryChartOptions()" size="large" [showLegend]="false"></app-chart>
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
export class ProfitLossComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);

  loading = signal(true);
  exporting = signal(false);
  data = signal<ProfitLossSummary | null>(null);

  revenueCostsChartOptions= signal<EChartsOption>({});
  profitSummaryChartOptions= signal<EChartsOption>({});

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

    this.analyticsService.getProfitLossSummary({}).subscribe({
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
        a.download = `estado_resultados_${new Date().toISOString().split('T')[0]}.csv`;
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

    // Revenue vs Costs Bar Chart
    this.revenueCostsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `${params[0].name}<br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: <b>${this.currencyService.format(p.value)}</b><br/>`;
          }
          return html;
        },
      },
      legend: {
        data: ['Ingresos', 'COGS', 'Reembolsos', 'Gastos'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: ['Ingresos', 'COGS', 'Reembolsos', 'Gastos Operativos'],
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
          name: 'Ingresos',
          type: 'line',
          data: [d.revenue?.gross_revenue || 0],
          itemStyle: { color: '#22c55e' },
        },
        {
          name: 'COGS',
          type: 'line',
          data: [-(d.costs?.cost_of_goods_sold || 0)],
          itemStyle: { color: '#ef4444' },
        },
        {
          name: 'Reembolsos',
          type: 'line',
          data: [-(d.refunds?.total_refunds || 0)],
          itemStyle: { color: '#f59e0b' },
        },
        {
          name: 'Gastos Operativos',
          type: 'line',
          data: [-(d.operating_expenses || 0)],
          itemStyle: { color: '#8b5cf6' },
        },
      ],
    });

    // Profit Summary Pie
    const grossProfit = d.costs?.gross_profit || 0;
    const netProfit = d.bottom_line?.net_profit || 0;
    const refunds = d.refunds?.total_refunds || 0;
    const expenses = d.operating_expenses || 0;

    this.profitSummaryChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => `${params.name}: <b>${this.currencyService.format(params.value)}</b>`,
      },
      grid: { left: '3%', right: '10%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        data: ['Ganancia Bruta', 'Reembolsos', 'Gastos', 'Ganancia Neta'],
        axisLabel: { color: textSecondary },
      },
      series: [
        {
          name: 'Ganancias',
          type: 'line',
          data: [
            { value: Math.max(0, grossProfit), itemStyle: { color: '#22c55e' } },
            { value: Math.max(0, refunds), itemStyle: { color: '#f59e0b' } },
            { value: Math.max(0, expenses), itemStyle: { color: '#8b5cf6' } },
            { value: Math.max(0, netProfit), itemStyle: { color: '#3b82f6' } },
          ],
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
        },
      ],
    });
  }

  getNetProfitClass(): string {
    const profit = this.data()?.bottom_line?.net_profit || 0;
    return profit >= 0 ? 'border-l-4 border-green-500' : 'border-l-4 border-red-500';
  }

  getPeriodLabel(): string {
    const dataObj = this.data();
    if (!dataObj?.period) return '';
    const start = new Date(dataObj.period.start_date).toLocaleDateString('es');
    const end = new Date(dataObj.period.end_date).toLocaleDateString('es');
    return `${start} - ${end}`;
  }
}