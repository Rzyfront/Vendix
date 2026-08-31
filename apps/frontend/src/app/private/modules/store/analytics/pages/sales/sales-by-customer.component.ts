import { Component, OnInit, inject, computed, signal,
  DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  SalesByCustomer,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';
import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-sales-by-customer',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
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
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Clientes"
          [value]="chartData().length"
          smallText=" clientes"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Ingresos Total"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Cliente Top"
          [value]="getTopCustomerName()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Ingreso Promedio"
          [value]="getAvgRevenue()"
          smallText="por cliente"
          iconName="bar-chart-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="users" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Ventas por Cliente</span>
        </div>
        <div class="flex items-end gap-2 flex-wrap shrink-0">
        <app-options-dropdown
                    class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                    [filters]="filterConfigs()"
                    [filterValues]="dropdownFilterValues()"
                    [actions]="dropdownActions()"
                    [showActions]="true"
                    triggerLabel="Acciones"
                    triggerIcon="plus"
                    [debounceMs]="350"
                    [isLoading]="exporting()"
                    (filterChange)="onFiltersDropdownChange($event)"
                    (clearAllFilters)="onClearAllFilters()"
                    (actionClick)="onActionsDropdownClick($event)"
                  ></app-options-dropdown>
        </div>
      </div>
      <div class="p-4 space-y-6">


      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="results-header flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Top Clientes
            <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
              ({{ chartData().length }} clientes)
            </span>
          </span>
        </div>

        <div class="p-4">
          @if (chartLoading()) {
            <div class="h-80 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else {
            <app-chart
              [options]="topCustomersChartOptions()"
              size="large"
              [showLegend]="true"
            ></app-chart>
          }
        </div>
      </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Ventas</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of salesViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
          </div>
    </app-card>
</div>

`})
export class SalesByCustomerComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  chartLoading = signal(false);
  exporting = signal(false);
  chartData = signal<SalesByCustomer[]>([]);
  topCustomersChartOptions = signal<EChartsOption>({});
  private chartQueryKey = signal<string | null>(null);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales').filter(
    (v) => v.key !== 'sales_by_customer'
  );

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    const initial: DateRangeFilter = urlRange ?? {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(initial);
    this.dropdownFilterValues.set({
      date_range_start: initial.start_date,
      date_range_end: initial.end_date,
      date_range_preset: initial.preset ?? null,
    });

    this.loadChartData();
  }

  /**
   * Filters surfaced via the unified `<app-options-dropdown>`.
   * Always starts with `date-range` (Período) and grows from there.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    { key: 'date_range', type: 'date-range', label: 'Período' },
  ]);

  /**
   * Mirror state exposed back to the dropdown so its internal `localFilterValues`
   * stays in sync with the canonical `dateRange` signal — including resets.
   */
  readonly dropdownFilterValues = signal<FilterValues>({});

  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'] as string | null;
    const end = values['date_range_end'] as string | null;
    const preset = values['date_range_preset'] as string | null;
    if (!start || !end) {
      return;
    }

    const next: DateRangeFilter = {
      start_date: start,
      end_date: end,
      preset: (preset || 'custom') as DateRangeFilter['preset'],
    };

    const current = this.dateRange();
    if (
      next.start_date === current.start_date &&
      next.end_date === current.end_date &&
      next.preset === current.preset
    ) {
      return;
    }

    this.dateRange.set(next);
    this.dropdownFilterValues.set({
      date_range_start: next.start_date,
      date_range_end: next.end_date,
      date_range_preset: next.preset ?? null,
    });
    this.loadChartData();
  }

  onClearAllFilters(): void {
    const defaults: DateRangeFilter = {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(defaults);
    this.dropdownFilterValues.set({
      date_range_start: defaults.start_date,
      date_range_end: defaults.end_date,
      date_range_preset: defaults.preset ?? null,
    });
    this.loadChartData();
  }

  private buildQuery(): SalesAnalyticsQueryDto {
    return { date_range: this.dateRange(), limit: 10 };
  }

  private loadChartData(): void {
    const queryKey = JSON.stringify({ query: this.buildQuery() });
    if (this.chartQueryKey() === queryKey) return;

    this.chartLoading.set(true);

    this.analyticsService
      .getSalesByCustomer(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const customers = this.extractRows(response);
          this.chartData.set(customers);
          this.updateChart(customers);
          this.chartQueryKey.set(queryKey);
          this.chartLoading.set(false);
        },
        error: () => {
          this.chartData.set([]);
          this.updateChart([]);
          this.toastService.error('Error al cargar ventas por cliente');
          this.chartLoading.set(false);
        }});
  }

  private extractRows(response: any): SalesByCustomer[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
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
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }


  formatCurrency(value: number): string {
    return this.currencyService.format(value, 0);
  }

  private updateChart(data: SalesByCustomer[]): void {
    const top10 = Array.isArray(data) && data.length > 0
      ? [...data].sort((a, b) => b.total_spent - a.total_spent).slice(0, 10)
      : [];

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    const hasData = top10.length > 0;
    const customerNames = hasData ? top10.map((c) => c.customer_name) : ['Sin datos'];
    const customerValues = hasData ? top10.map((c) => c.total_spent) : [0];

    this.topCustomersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!params?.[0]) return '';
          const p = params[0];
          const customer = top10.find((c) => c.total_spent === p.value);
          return `${p.name}<br/>Total: ${this.currencyService.format(p.value)}<br/>Órdenes: ${customer?.total_orders || 0}`;
        },
      },
      legend: {
        data: ['Top Clientes'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '25%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: customerNames,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 10, formatter: (val: string) => truncateLabel(val, 14) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Top Clientes',
        type: 'bar' as const,
        data: customerValues.map((v, i) => ({
          value: v,
          itemStyle: { color: hasData ? colors[i % colors.length] : '#d1d5db' }
        })),
        barMaxWidth: 50,
      }],
    });
  }

  getTotalRevenue(): string {
    const total = this.chartData().reduce((sum, c) => sum + (c.total_spent || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTopCustomerName(): string {
    if (!this.chartData().length) return '-';
    const top = [...this.chartData()].sort((a, b) => b.total_spent - a.total_spent)[0];
    return top?.customer_name?.substring(0, 15) || '-';
  }

  getAvgRevenue(): string {
    if (!this.chartData().length) return '-';
    const total = this.chartData().reduce((sum, c) => sum + (c.total_spent || 0), 0);
    return this.currencyService.format(total / this.chartData().length, 0);
  }
}
