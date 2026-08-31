import { Component, DestroyRef, OnInit, inject, computed, signal  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { TaxSummary, AnalyticsService } from '../../services/analytics.service';
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
  selector: 'vendix-tax-summary',
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
          <app-stats
            title="Impuestos Cobrados"
            [value]="data()?.total_tax_collected | currency"
            smallText="Total recaudado"
            iconName="plus-circle"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Impuestos Devueltos"
            [value]="data()?.total_tax_refunded | currency"
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
            [value]="effectiveRateDisplay()"
            valueUnit="%"
            smallText="Porcentaje sobre ingresos"
            iconName="percent"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>
        </div>
      }

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="percent" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Resumen de Impuestos</span>
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
        <!-- Tax Breakdown Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
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
          <div slot="header" class="results-header flex flex-col">
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

</div>
      <!-- DIAN posición panel -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4" overflow="hidden">
        <div class="flex flex-col gap-1 mb-4">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Posición DIAN</span>
          <span class="text-xs text-[var(--color-text-secondary)]">
            Lo que la declaración del período cierra, desglosado por figura fiscal.
          </span>
        </div>

        <!-- Hero figure: net_vat_position with sign convention -->
        <div class="flex items-center gap-3 mb-4 p-4 rounded-xl border"
             [class]="netVatPositionClass()">
          <app-icon name="calculator" [class]="netVatPositionIconClass()"></app-icon>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium opacity-80">
              {{ netVatPositionLabel() }}
            </div>
            <div class="text-2xl font-bold leading-tight">
              {{ data()?.net_vat_position | currency }}
            </div>
          </div>
        </div>

        <!-- Generado / Descontable / Retenciones breakdown -->
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">IVA generado</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.iva_generado | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Ventas gravadas</div>
          </div>
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">INC generado</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.inc_generado | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Impuesto nacional al consumo</div>
          </div>
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">ICA generado</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.ica_generado | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Industria y comercio</div>
          </div>
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">IVA descontable</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.iva_descontable | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Crédito por compras</div>
          </div>
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Retenciones practicadas</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.rete_practicadas | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Ventas (crédito)</div>
          </div>
          <div class="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Retenciones sufridas</div>
            <div class="text-lg font-bold text-[var(--color-text-primary)]">
              {{ data()?.rete_sufridas | currency }}
            </div>
            <div class="text-[10px] text-[var(--color-text-secondary)] mt-0.5">Compras (crédito)</div>
          </div>
        </div>
      </app-card>

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
export class TaxSummaryComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

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
      .getTaxSummary({ date_range: this.dateRange() })
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

    const taxCategories = ['Cobrados', 'Devueltos', 'Neto'];
    const taxValues = [d.total_tax_collected || 0, d.total_tax_refunded || 0, d.net_tax || 0];
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
        axisLabel: { color: textSecondary, formatter: (val: string) => truncateLabel(val, 14) },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
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

    // Effective Rate Gauge — null guard: the contract returns `null` when
    // there is no taxable revenue. Render the gauge at 0 only if the value
    // is a number; otherwise render an empty gauge with a "Sin base" label.
    const rateValue = d.effective_tax_rate;
    const hasRate = rateValue !== null && rateValue !== undefined;
    const rate = hasRate ? Math.min(rateValue, 30) : 0;
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
            show: hasRate,
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
            formatter: (value: number) =>
              hasRate ? `${value.toFixed(1)}%` : 'Sin base',
            fontSize: 20,
            fontWeight: 'bold',
            offsetCenter: [0, '20%'],
            color: !hasRate
              ? textSecondary
              : rate < 10
                ? '#22c55e'
                : rate < 20
                  ? '#f59e0b'
                  : '#ef4444',
          },
          data: [{ value: rate }],
        },
      ],
    });
  }

  /**
   * Effective rate display value for the KPI card. The StatsComponent accepts
   * `string | number`, so we return "Sin base" as a string when the contract
   * returns null (no taxable revenue). The contract's `computeEffectiveTaxRate`
   * explicitly requires this: never `0 %`, render "Sin base" instead.
   */
  effectiveRateDisplay(): string | number {
    const rate = this.data()?.effective_tax_rate;
    if (rate === null || rate === undefined) return 'Sin base';
    return rate;
  }

  /**
   * Sign-convention label for the DIAN posición hero figure.
   * Positivo: "Saldo a cargo" (store owes the DIAN).
   * Negativo: "Saldo a favor" (store has a credit).
   * Cero: "Sin saldo".
   */
  netVatPositionLabel(): string {
    const pos = this.data()?.net_vat_position ?? 0;
    if (pos > 0) return 'Saldo a cargo';
    if (pos < 0) return 'Saldo a favor';
    return 'Sin saldo';
  }

  /**
   * Visual class for the net_vat_position hero — color-coded by sign so the
   * merchant sees at a glance whether the store owes the DIAN or has a credit.
   */
  netVatPositionClass(): string {
    const pos = this.data()?.net_vat_position ?? 0;
    if (pos > 0) {
      return 'bg-red-50 border-red-200 text-red-700';
    }
    if (pos < 0) {
      return 'bg-green-50 border-green-200 text-green-700';
    }
    return 'bg-gray-50 border-gray-200 text-gray-700';
  }

  netVatPositionIconClass(): string {
    const pos = this.data()?.net_vat_position ?? 0;
    if (pos > 0) return 'text-red-600';
    if (pos < 0) return 'text-green-600';
    return 'text-gray-500';
  }
}
