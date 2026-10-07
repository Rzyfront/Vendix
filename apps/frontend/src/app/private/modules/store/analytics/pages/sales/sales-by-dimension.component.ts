import {
  Component,
  OnInit,
  inject,
  computed,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { EChartsOption } from 'echarts';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  getDefaultStartDate,
  getDefaultEndDate,
} from '../../../../../../shared/utils/date.util';
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';
import {
  queryParamsToDateRange,
  dateRangeToQueryParams,
} from '../../../shared/utils/date-range-params.util';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  SalesDimension,
  SalesDimensionView,
  SalesByDimensionQuery,
  SalesByDimensionResponse,
  SalesByDimensionRow,
  SalesByDimensionSummary,
} from '../../interfaces/sales-analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { BrandsService } from '../../../products/services/brands.service';

type DetailView = Exclude<SalesDimensionView, 'dimension'>;

const VIEW_VALUES: DetailView[] = ['product', 'user', 'customer'];
const TOP_N = 10;
const BAR_COLOR = '#3b82f6';
const EMPTY_SUMMARY: SalesByDimensionSummary = {
  net_sales: 0,
  units: 0,
  orders: 0,
  impacted_customers: 0,
  distinct_references: 0,
};

/** Etiqueta legible de una fila según la vista de detalle. */
function rowLabel(row: SalesByDimensionRow, view: DetailView): string {
  const r = row as unknown as Record<string, unknown>;
  if (view === 'user') return String(r['user_name'] ?? '');
  if (view === 'customer') return String(r['customer_name'] ?? '');
  const name = String(r['product_name'] ?? '');
  return r['variant_name'] ? `${name} — ${String(r['variant_name'])}` : name;
}

/** Hace únicas las etiquetas del eje de categorías (ECharts fusiona nombres repetidos). */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n > 1 ? `${l} (${n})` : l;
  });
}

@Component({
  selector: 'vendix-sales-by-dimension',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
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
          title="Venta neta"
          [value]="netSalesLabel()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Unidades"
          [value]="summary().units"
          smallText=" unidades"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Clientes impactados"
          [value]="summary().impacted_customers"
          smallText=" clientes"
          iconName="users"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Referencias"
          [value]="summary().distinct_references"
          smallText=" referencias"
          iconName="layers"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon [name]="headerIcon()" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              {{ title() }}
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
              (filterChange)="onFiltersDropdownChange($event)"
              (clearAllFilters)="onClearAllFilters()"
              (actionClick)="onActionsDropdownClick($event)"
            ></app-options-dropdown>
          </div>
        </div>

        <div class="p-4 space-y-6">
          @if (dimension() === 'supplier') {
            <p class="text-xs text-[var(--color-text-secondary)]">
              Las ventas se atribuyen al proveedor asignado al producto o, si no tiene, al de su última orden de compra.
            </p>
          }

          <div class="grid grid-cols-1 gap-6">
            <!-- Chart 1: venta neta por proveedor/marca -->
            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  {{ dimensionChartTitle() }}
                  <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
                    (top {{ dimensionRows().length }})
                  </span>
                </span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-80 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (dimensionRows().length === 0) {
                  <div class="h-80 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
                    Sin ventas en el período para los filtros seleccionados.
                  </div>
                } @else {
                  <app-chart [options]="dimensionChartOptions()" size="large" [showLegend]="false"></app-chart>
                }
              </div>
            </app-card>

            <!-- Chart 2: top 10 según la vista -->
            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  {{ detailChartTitle() }}
                  <span class="text-xs text-[var(--color-text-secondary)] font-normal ml-2">
                    (top {{ detailRows().length }})
                  </span>
                </span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-80 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (detailRows().length === 0) {
                  <div class="h-80 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
                    Sin ventas en el período para los filtros seleccionados.
                  </div>
                } @else {
                  <app-chart [options]="detailChartOptions()" size="large" [showLegend]="false"></app-chart>
                }
              </div>
            </app-card>
          </div>

          <!-- Quick Links -->
          <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Ventas</span>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              @for (view of salesViews(); track view.key) {
                <app-analytics-card [view]="view"></app-analytics-card>
              }
            </div>
          </app-card>
        </div>
      </app-card>
    </div>
  `,
})
export class SalesByDimensionComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly suppliersService = inject(SuppliersService);
  private readonly brandsService = inject(BrandsService);

  readonly dimension = signal<SalesDimension>(
    (this.route.snapshot.data['dimension'] as SalesDimension) ?? 'supplier',
  );
  readonly dimensionLabel = computed(() =>
    this.dimension() === 'supplier' ? 'Proveedor' : 'Marca',
  );
  readonly title = computed(() =>
    this.dimension() === 'supplier' ? 'Ventas por proveedor' : 'Ventas por marca',
  );
  readonly headerIcon = computed(() =>
    this.dimension() === 'supplier' ? 'truck' : 'tag',
  );
  readonly dimensionChartTitle = computed(() =>
    this.dimension() === 'supplier'
      ? 'Venta neta por proveedor'
      : 'Venta neta por marca',
  );
  readonly detailChartTitle = computed(() => {
    switch (this.view()) {
      case 'user':
        return 'Top 10 vendedores';
      case 'customer':
        return 'Top 10 clientes';
      default:
        return 'Top 10 productos';
    }
  });

  readonly loading = signal(false);
  readonly dimensionRows = signal<SalesByDimensionRow[]>([]);
  readonly detailRows = signal<SalesByDimensionRow[]>([]);
  readonly summary = signal<SalesByDimensionSummary>(EMPTY_SUMMARY);

  readonly view = signal<DetailView>('product');
  readonly selectedIds = signal<string[]>([]);
  readonly dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });
  private readonly entityOptions = signal<{ value: string; label: string }[]>([]);

  readonly salesViews = computed<AnalyticsView[]>(() =>
    getViewsByCategory('sales').filter(
      (v) =>
        v.key !== (this.dimension() === 'supplier' ? 'sales_by_supplier' : 'sales_by_brand'),
    ),
  );

  readonly netSalesLabel = computed(() =>
    this.currencyService.format(Number(this.summary().net_sales) || 0, 0),
  );

  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const noneLabel = this.dimension() === 'supplier' ? 'Sin proveedor' : 'Sin marca';
    return [
      { key: 'date_range', type: 'date-range', label: 'Período' },
      {
        key: 'ids',
        type: 'multi-select',
        label: this.dimensionLabel(),
        placeholder: this.dimension() === 'supplier' ? 'Todos los proveedores' : 'Todas las marcas',
        options: [{ value: '0', label: noneLabel }, ...this.entityOptions()],
      },
      {
        key: 'view',
        type: 'select',
        label: 'Vista',
        defaultValue: 'product',
        options: [
          { value: 'product', label: 'Por producto' },
          { value: 'user', label: 'Por vendedor' },
          { value: 'customer', label: 'Por cliente' },
        ],
      },
    ];
  });

  readonly dropdownFilterValues = signal<FilterValues>({});

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { action: 'refresh', label: 'Actualizar', icon: 'refresh-cw' },
  ]);

  readonly dimensionChartOptions = computed<EChartsOption>(() => {
    // Los datos llegan ordenados desc; el eje de categorías se invierte para que el mayor quede arriba.
    const rows = this.dimensionRows();
    const names = uniqueLabels(rows.map((r) => r.dimension_name));
    return this.buildBarOptions(
      names,
      rows.map((r) => ({
        value: Number(r.net_sales) || 0,
        tip: `Unidades: ${Number((r as any).units) || 0}<br/>Órdenes: ${Number(r.orders) || 0}`,
      })),
      this.dimensionChartTitle(),
    );
  });

  readonly detailChartOptions = computed<EChartsOption>(() => {
    const rows = this.detailRows();
    const view = this.view();
    const multiDimension = new Set(rows.map((r) => r.dimension_id)).size > 1;
    const labels = uniqueLabels(
      rows.map((r) => {
        const base = rowLabel(r, view);
        return multiDimension ? `${base} · ${r.dimension_name}` : base;
      }),
    );
    return this.buildBarOptions(
      labels,
      rows.map((r) => ({
        value: Number(r.net_sales) || 0,
        tip:
          (multiDimension ? `${this.dimensionLabel()}: ${r.dimension_name}<br/>` : '') +
          `Unidades: ${Number((r as any).units) || 0}<br/>Órdenes: ${Number(r.orders) || 0}`,
        full: rowLabel(r, view),
      })),
      this.detailChartTitle(),
    );
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadEntityOptions();

    const qp = this.route.snapshot.queryParamMap;
    const urlRange = queryParamsToDateRange(qp);
    const range: DateRangeFilter = urlRange ?? {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(range);

    const urlView = qp.get('view') as DetailView | null;
    this.view.set(urlView && VIEW_VALUES.includes(urlView) ? urlView : 'product');

    const urlIds = qp.get('ids');
    this.selectedIds.set(urlIds ? urlIds.split(',').filter((x) => x !== '') : []);

    this.syncDropdownValues();
    this.loadData();
  }

  private buildBarOptions(
    names: string[],
    points: { value: number; tip: string; full?: string }[],
    seriesName: string,
  ): EChartsOption {
    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          if (!p) return '';
          const point = points[p.dataIndex];
          if (!point) return '';
          const title = point.full ?? names[p.dataIndex];
          return `<strong>${title}</strong><br/>Venta neta: ${this.currencyService.format(point.value, 0)}<br/>${point.tip}`;
        },
      },
      grid: { left: '3%', right: '6%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: {
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
      yAxis: {
        type: 'category',
        inverse: true,
        data: names,
        axisLine: { lineStyle: { color: borderColor } },
        axisTick: { show: false },
        axisLabel: {
          color: textSecondary,
          fontSize: 11,
          formatter: (val: string) => truncateLabel(val, 24),
        },
      },
      series: [
        {
          name: seriesName,
          type: 'bar' as const,
          data: points.map((p) => ({ value: p.value, itemStyle: { color: BAR_COLOR } })),
          barMaxWidth: 28,
        },
      ],
    };
  }

  private loadEntityOptions(): void {
    if (this.dimension() === 'supplier') {
      this.suppliersService
        .getSuppliers({ limit: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) =>
            this.entityOptions.set(
              (res.data ?? []).map((s) => ({ value: String(s.id), label: s.name })),
            ),
          error: () => this.toastService.error('Error al cargar proveedores'),
        });
    } else {
      this.brandsService
        .getAllBrands()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (brands) =>
            this.entityOptions.set(
              (brands ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ),
          error: () => this.toastService.error('Error al cargar marcas'),
        });
    }
  }

  private syncDropdownValues(): void {
    const r = this.dateRange();
    this.dropdownFilterValues.set({
      date_range_start: r.start_date,
      date_range_end: r.end_date,
      date_range_preset: r.preset ?? null,
      ids: this.selectedIds(),
      view: this.view(),
    });
  }

  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'] as string | null;
    const end = values['date_range_end'] as string | null;
    const preset = values['date_range_preset'] as string | null;
    if (!start || !end) return;

    const rawIds = values['ids'];
    const ids = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [];
    const rawView = values['view'] as DetailView | null;
    const view = rawView && VIEW_VALUES.includes(rawView) ? rawView : 'product';

    const next: DateRangeFilter = {
      start_date: start,
      end_date: end,
      preset: (preset || 'custom') as DateRangeFilter['preset'],
    };
    const cur = this.dateRange();
    const same =
      next.start_date === cur.start_date &&
      next.end_date === cur.end_date &&
      next.preset === cur.preset &&
      view === this.view() &&
      ids.join(',') === this.selectedIds().join(',');
    if (same) return;

    this.dateRange.set(next);
    this.view.set(view);
    this.selectedIds.set(ids);
    this.syncDropdownValues();
    this.persistQueryParams();
    this.loadData();
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.view.set('product');
    this.selectedIds.set([]);
    this.syncDropdownValues();
    this.persistQueryParams();
    this.loadData();
  }

  onActionsDropdownClick(action: string): void {
    if (action === 'refresh') {
      this.analyticsService.requestInvalidation();
      this.loadData();
    }
  }

  private persistQueryParams(): void {
    const ids = this.selectedIds();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        ...dateRangeToQueryParams(this.dateRange()),
        ids: ids.length ? ids.join(',') : null,
        view: this.view() === 'product' ? null : this.view(),
      },
      queryParamsHandling: 'merge',
    });
  }

  private buildQuery(view: SalesDimensionView): SalesByDimensionQuery {
    const ids = this.selectedIds();
    return {
      dimension: this.dimension(),
      ids: ids.length ? ids.join(',') : undefined,
      view,
      date_range: this.dateRange(),
      page: 1,
      limit: TOP_N,
    };
  }

  private loadData(): void {
    this.loading.set(true);
    forkJoin({
      dim: this.analyticsService.getSalesByDimension(this.buildQuery('dimension')),
      detail: this.analyticsService.getSalesByDimension(this.buildQuery(this.view())),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ dim, detail }: { dim: SalesByDimensionResponse; detail: SalesByDimensionResponse }) => {
          this.dimensionRows.set(dim.data ?? []);
          this.detailRows.set(detail.data ?? []);
          this.summary.set(dim.meta?.summary ?? EMPTY_SUMMARY);
          this.loading.set(false);
        },
        error: () => {
          this.dimensionRows.set([]);
          this.detailRows.set([]);
          this.summary.set(EMPTY_SUMMARY);
          this.toastService.error(`Error al cargar ${this.title().toLowerCase()}`);
          this.loading.set(false);
        },
      });
  }
}
