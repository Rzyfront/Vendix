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
  SalesByProduct,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';
import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-sales-by-product',
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
          title="Total Productos"
          [value]="chartData().length"
          smallText=" productos en el período"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Unidades Vendidas"
          [value]="getTotalUnits()"
          smallText=" totales"
          iconName="boxes"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Ingresos Totales"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Producto Más Vendido"
          [value]="getTopProductName()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="package" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Ventas por Producto</span>
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
            Productos Vendidos
            <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
              ({{ chartData().length }} productos)
            </span>
          </span>
        </div>
        <div class="p-4">
          @if (!chartLoading() && topProductsChartOptions()) {
          <app-chart
            [options]="topProductsChartOptions()"
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
export class SalesByProductComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  chartLoading = signal(false);
  exporting = signal(false);
  chartData = signal<SalesByProduct[]>([]);
  topProductsChartOptions = signal<EChartsOption>({});
  private chartQueryKey = signal<string | null>(null);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales').filter(
    (v) => v.key !== 'sales_by_product'
  );

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from Reports)
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
    this.invalidateModeData();

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
    this.invalidateModeData();
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
    this.invalidateModeData();
    this.loadChartData();
  }

  private buildQuery(): SalesAnalyticsQueryDto {
    return {
      date_range: this.dateRange(),
      limit: 10,
    };
  }

  private buildQueryKey(): string {
    return JSON.stringify({ query: this.buildQuery() });
  }

  private invalidateModeData(): void {
    this.chartQueryKey.set(null);
  }

  private loadChartData(): void {
    const queryKey = this.buildQueryKey();
    if (this.chartQueryKey() === queryKey) return;

    this.chartLoading.set(true);

    this.analyticsService
      .getSalesByProduct(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = this.extractRows(response);
          this.chartData.set(rows);
          this.updateChart(rows);
          this.chartQueryKey.set(queryKey);
          this.chartLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar ventas por producto');
          this.chartLoading.set(false);
        }});
  }

  private extractRows(response: any): SalesByProduct[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
  }

  private updateChart(data: SalesByProduct[]): void {

    const top10 = [...data]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6'];

    this.topProductsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Ingresos: ${this.currencyService.format(p.value)}`;
        },
      },
      legend: {
        data: ['Productos'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '25%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: top10.map((p) => p.product_name),
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (val: string) => truncateLabel(val, 14) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Productos',
        type: 'bar',
        data: top10.map((p, i) => ({ value: p.revenue, itemStyle: { color: colors[i % colors.length] } })),
        barMaxWidth: 50,
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
          a.download = `ventas_producto_${new Date().toISOString().split('T')[0]}.csv`;
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

  getTotalUnits(): number {
    return this.chartData().reduce((sum, p) => sum + (p.units_sold || 0), 0);
  }

  getTotalRevenue(): string {
    const total = this.chartData().reduce((sum, p) => sum + (p.revenue || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTopProductName(): string {
    if (!this.chartData().length) return '-';
    const top = [...this.chartData()].sort((a, b) => b.units_sold - a.units_sold)[0];
    return top?.product_name?.substring(0, 15) + (top.product_name.length > 15 ? '...' : '') || '-';
  }

}
