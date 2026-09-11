import {
  Component,
  OnInit,
  inject,
  computed,
  signal,
  DestroyRef,
} from '@angular/core';
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
  OptionsDropdownComponent,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';
import {
  SalesByUser,
  SalesAnalyticsQueryDto,
} from '../../interfaces/sales-analytics.interface';
import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-sales-by-user',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) {
          margin: -24px;
        }
      }
      :host ::ng-deep .stats-container {
        padding: 0;
        margin: 0;
        margin-bottom: 0;
      }
      :host ::ng-deep .results-header {
        padding: 0.75rem 1rem;
      }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Vendedores"
          [value]="data().length"
          smallText=" vendedores"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total Vendido"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Órdenes Totales"
          [value]="getTotalOrders()"
          smallText=" órdenes"
          iconName="shopping-bag"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Vendedor Top"
          [value]="getTopSellerName()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="user-check" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              Ventas por Vendedor
            </span>
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
            <!-- Chart Card -->
            <app-card
              shadow="none"
              [padding]="false"
              overflow="hidden"
              [showHeader]="true"
            >
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Top Vendedores por Ventas
                  <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
                    ({{ data().length }} vendedores)
                  </span>
                </span>
              </div>

              <div class="p-4">
                @if (loading()) {
                  <div class="h-80 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else {
                  <app-chart
                    [options]="chartOptions()"
                    size="large"
                    [showLegend]="true"
                  ></app-chart>
                }
              </div>
            </app-card>

            <!-- Table Card -->
            <app-card
              shadow="none"
              [padding]="false"
              overflow="hidden"
              [showHeader]="true"
            >
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Detalle por Vendedor
                  <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
                    ({{ data().length }} vendedores registrados)
                  </span>
                </span>
              </div>

              <div class="p-4">
                <app-responsive-data-view
                  [data]="data()"
                  [columns]="columns"
                  [cardConfig]="cardConfig"
                  [loading]="loading()"
                  [striped]="true"
                  tableSize="sm"
                  emptyMessage="Sin ventas por vendedor registradas en este período"
                  emptyIcon="user-x"
                ></app-responsive-data-view>
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
  `,
})
export class SalesByUserComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

  loading = signal(false);
  exporting = signal(false);
  data = signal<SalesByUser[]>([]);
  chartOptions = signal<EChartsOption>({});
  private chartQueryKey = signal<string | null>(null);

  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales').filter(
    (v) => v.key !== 'sales_by_user',
  );

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    { key: 'date_range', type: 'date-range', label: 'Período' },
  ]);

  readonly dropdownFilterValues = signal<FilterValues>({});

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'refresh',
      label: 'Actualizar',
      icon: 'refresh-cw',
    },
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly columns: TableColumn[] = [
    {
      key: 'user_name',
      label: 'Vendedor',
      sortable: true,
    },
    {
      key: 'user_email',
      label: 'Correo',
      sortable: true,
      transform: (val: string) => val || '—',
    },
    {
      key: 'orders_count',
      label: 'Órdenes',
      align: 'right',
      sortable: true,
    },
    {
      key: 'items_sold',
      label: 'Unidades',
      align: 'right',
      sortable: true,
    },
    {
      key: 'grand_total',
      label: 'Total Vendido',
      align: 'right',
      sortable: true,
      transform: (val: number) => this.currencyService.format(val, 0),
    },
    {
      key: 'avg_order',
      label: 'Ticket Promedio',
      align: 'right',
      sortable: true,
      transform: (val: number) => this.currencyService.format(val, 0),
    },
    {
      key: 'last_order_date',
      label: 'Última Venta',
      align: 'right',
      sortable: true,
      transform: (val: string | null) => {
        if (!val) return '—';
        const d = new Date(val);
        return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('es-CO');
      },
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'user_name',
    subtitleKey: 'user_email',
    avatarFallbackIcon: 'user',
    detailKeys: [
      { key: 'orders_count', label: 'Órdenes' },
      { key: 'items_sold', label: 'Unidades' },
      {
        key: 'grand_total',
        label: 'Total Vendido',
        transform: (val: number) => this.currencyService.format(val, 0),
      },
      {
        key: 'avg_order',
        label: 'Ticket Promedio',
        transform: (val: number) => this.currencyService.format(val, 0),
      },
      {
        key: 'last_order_date',
        label: 'Última Venta',
        transform: (val: string | null) => {
          if (!val) return '—';
          const d = new Date(val);
          return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('es-CO');
        },
      },
    ],
  };

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

    this.loadData();
  }

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
    this.loadData();
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
    this.loadData();
  }

  onActionsDropdownClick(action: string): void {
    if (action === 'refresh') {
      this.onRefresh();
    } else if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onRefresh(): void {
    this.analyticsService.requestInvalidation();
    this.chartQueryKey.set(null);
    this.loadData();
  }

  private buildQuery(): SalesAnalyticsQueryDto {
    return { date_range: this.dateRange(), limit: 100 };
  }

  private loadData(): void {
    const queryKey = JSON.stringify({ query: this.buildQuery() });
    if (this.chartQueryKey() === queryKey) return;

    this.loading.set(true);

    this.analyticsService
      .getSalesByUser(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const sellers = this.extractRows(response);
          this.data.set(sellers);
          this.updateChart(sellers);
          this.chartQueryKey.set(queryKey);
          this.loading.set(false);
        },
        error: () => {
          this.data.set([]);
          this.updateChart([]);
          this.toastService.error('Error al cargar ventas por vendedor');
          this.loading.set(false);
        },
      });
  }

  private extractRows(response: any): SalesByUser[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesByUser(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ventas_por_vendedor_${new Date().toISOString().split('T')[0]}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar ventas por vendedor');
          this.exporting.set(false);
        },
      });
  }

  private updateChart(data: SalesByUser[]): void {
    const top10 = Array.isArray(data) && data.length > 0
      ? [...data].sort((a, b) => (Number(b.grand_total) || 0) - (Number(a.grand_total) || 0)).slice(0, 10)
      : [];

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    const hasData = top10.length > 0;
    const sellerNames = hasData ? top10.map((s) => s.user_name) : ['Sin datos'];
    const sellerValues = hasData ? top10.map((s) => s.grand_total) : [0];

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!params?.[0]) return '';
          const p = params[0];
          const seller = top10.find((s) => s.user_name === p.name || s.grand_total === p.value);
          return `${p.name}<br/>Total: ${this.currencyService.format(p.value)}<br/>Órdenes: ${seller?.orders_count || 0}<br/>Unidades: ${seller?.items_sold || 0}`;
        },
      },
      legend: {
        data: ['Top Vendedores'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '25%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sellerNames,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: {
          color: textSecondary,
          fontSize: 10,
          formatter: (val: string) => truncateLabel(val, 14),
        },
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
      series: [
        {
          name: 'Top Vendedores',
          type: 'bar' as const,
          data: sellerValues.map((v, i) => ({
            value: v,
            itemStyle: { color: hasData ? colors[i % colors.length] : '#d1d5db' },
          })),
          barMaxWidth: 50,
        },
      ],
    });
  }

  getTotalRevenue(): string {
    const total = this.data().reduce((sum, s) => sum + (Number(s.grand_total) || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTotalOrders(): number {
    return this.data().reduce((sum, s) => sum + (Number(s.orders_count) || 0), 0);
  }

  getTopSellerName(): string {
    if (!this.data().length) return '—';
    const top = [...this.data()].sort(
      (a, b) => (Number(b.grand_total) || 0) - (Number(a.grand_total) || 0),
    )[0];
    return top?.user_name?.substring(0, 18) || '—';
  }
}
