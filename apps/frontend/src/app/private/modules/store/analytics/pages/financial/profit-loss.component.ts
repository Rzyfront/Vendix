import { Component, DestroyRef, OnInit, inject, computed, signal  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ProfitLossSummary, RefundsSummary, AnalyticsService } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { truncateLabel, compactCountAxis } from '../../../../../../shared/utils/chart-labels.util';

import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
@Component({
  selector: 'vendix-profit-loss',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    AnalyticsCardComponent,

    OptionsDropdownComponent,],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
      :host ::ng-deep .results-header { padding: 0.75rem 1rem; }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Stats Cards -->
      @if (loading()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else if (data()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <!-- Operating revenue, NOT net_revenue: it is the base the margins below
               divide by, so the chain on screen closes
               (ingresos − COGS = ganancia bruta). -->
          <app-stats
            title="Ingresos Operacionales"
            [value]="data()?.revenue?.operating_revenue | currency"
            smallText="Sin IVA, incluye envío cobrado"
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

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="trending-up" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Estado de Resultados</span>
        </div>
        <div class="flex items-end gap-2 flex-wrap shrink-0">
        <app-options-dropdown
                    class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                    [filters]="filterConfigs"
                    [filterValues]="filterValues()"
                    [actions]="dropdownActions()"
                    [showActions]="true"
                    triggerLabel="Acciones"
                    triggerIcon="plus"
                    [debounceMs]="350"
                    [isLoading]="exporting()"
                    (filterChange)="onFilterChange($event)"
                    (clearAllFilters)="onClearAllFilters()"
                    (actionClick)="onActionsDropdownClick($event)"
                  ></app-options-dropdown>
        </div>
      </div>
      <div class="p-4 space-y-6">


      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
        <!-- Charts Row -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Revenue vs Costs Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
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
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Resumen del Período</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Detalle de ingresos, costos y ganancias</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="profitSummaryChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>
      </div>
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
    </app-card>
</div>

`,
})
export class ProfitLossComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

  loading = signal(true);
  exporting = signal(false);
  data = signal<ProfitLossSummary | null>(null);

  revenueCostsChartOptions= signal<EChartsOption>({});
  profitSummaryChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly financialViews: AnalyticsView[] = getViewsByCategory('financial');

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService
      .getProfitLossSummary({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
    this.analyticsService
      .exportFinancialAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range',
    },
  ];

  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
    };
  });

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onFilterChange(values: FilterValues): void {
    const start = values['date_range_start'] as string;
    const end = values['date_range_end'] as string;
    const preset = values['date_range_preset'] as string;
    if (start && end) {
      this.dateRange.set({
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      });
      this.loadData();
    }
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.loadData();
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
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: ['Ingresos', 'COGS', 'Reembolsos', 'Gastos Operativos'],
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary, formatter: (val: string) => truncateLabel(val, 14) },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      // The bars are the ACTUAL chain behind net_profit:
      // operating_revenue − COGS − operating_expenses.
      //
      // Hotfix post-PR-576: `operating_revenue` ya viene NETO de
      // reembolsos (ver `financial-analytics.service.ts:851`). Antes este
      // chart restaba `subtotal_refunds` encima, doble-contando los
      // reembolsos: una vez en `operating_revenue` y otra acá. La
      // consecuencia era que la suma de las barras NUNCA igualaba el
      // KPI de Ganancia Neta que el mismo chart pinta encima.
      series: [
        {
          name: 'Ingresos (neto de reembolsos)',
          type: 'bar',
          data: [d.revenue?.operating_revenue || 0],
          itemStyle: { color: '#22c55e' },
        },
        {
          name: 'COGS',
          type: 'bar',
          data: [-(d.costs?.cost_of_goods_sold || 0)],
          itemStyle: { color: '#ef4444' },
        },
        {
          name: 'Gastos Operativos',
          type: 'bar',
          data: [-(d.operating_expenses || 0)],
          itemStyle: { color: '#8b5cf6' },
        },
      ],
    });

    // Profit Summary Bar Chart
    const grossProfit = d.costs?.gross_profit || 0;
    const netProfit = d.bottom_line?.net_profit || 0;
    const refunds = d.refunds?.total_refunds || 0;
    const expenses = d.operating_expenses || 0;

    this.profitSummaryChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `${params[0].name}<br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: <b>${this.currencyService.format(Math.abs(p.value))}</b><br/>`;
          }
          return html;
        },
      },
      legend: {
        data: ['Ganancia Bruta', 'Reembolsos', 'Gastos', 'Ganancia Neta'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        itemHeight: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: ['Ganancia Bruta', 'Reembolsos', 'Gastos', 'Ganancia Neta'],
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary, formatter: (val: string) => truncateLabel(val, 14) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => this.currencyService.formatChartAxis(v) },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Ganancia Bruta',
          type: 'bar',
          data: [{ value: grossProfit, itemStyle: { color: '#22c55e' } }],
          barMaxWidth: 50,
        },
        {
          name: 'Reembolsos',
          type: 'bar',
          data: [{ value: refunds, itemStyle: { color: '#f59e0b' } }],
          barMaxWidth: 50,
        },
        {
          name: 'Gastos',
          type: 'bar',
          data: [{ value: expenses, itemStyle: { color: '#ef4444' } }],
          barMaxWidth: 50,
        },
        {
          name: 'Ganancia Neta',
          type: 'bar',
          data: [{ value: netProfit, itemStyle: { color: '#3b82f6' } }],
          barMaxWidth: 50,
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
