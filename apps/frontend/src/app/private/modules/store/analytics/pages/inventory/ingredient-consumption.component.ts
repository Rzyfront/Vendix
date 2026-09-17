import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  IngredientConsumptionAnalyticsRow,
  InventoryAnalyticsQueryDto,
} from '../../interfaces/inventory-analytics.interface';
import { AnalyticsService } from '../../services/analytics.service';
import { AnalyticsRefreshService, Refreshable } from '../../../shared/services/analytics-refresh.service';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';

@Component({
  selector: 'vendix-ingredient-consumption',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
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
      <!-- 1. Stats Cards Strip (sticky on mobile) -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Costo Total Insumos"
          [value]="totalCostFormatted()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Insumos Distintos"
          [value]="metaTotals().total_ingredients"
          smallText=" ingredientes"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Platos Preparados"
          [value]="metaTotals().total_dishes"
          smallText=" platos"
          iconName="utensils"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Total Movimientos"
          [value]="metaTotals().total_movements"
          smallText=" movimientos"
          iconName="activity"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [loading]="loading()"
        ></app-stats>
      </div>

      <!-- 2. Main Analytics Card -->
      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-3 min-w-0">
            <app-icon name="utensils" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              Consumo de Insumos
              <span class="results-header__count text-xs md:text-sm text-text-secondary font-normal ml-2">
                @if (rows().length > 0) {
                  ({{ rows().length }} registros)
                }
              </span>
            </span>

            <!-- Group By Toggle -->
            <div class="inline-flex rounded-lg border border-[var(--color-border)] p-0.5 bg-[var(--color-bg-secondary)] ml-2">
              <button
                type="button"
                class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                [class.bg-[var(--color-bg-primary)]]="groupBy() === 'ingredient'"
                [class.text-[var(--color-text-primary)]]="groupBy() === 'ingredient'"
                [class.shadow-sm]="groupBy() === 'ingredient'"
                [class.text-[var(--color-text-secondary)]]="groupBy() !== 'ingredient'"
                (click)="onGroupByChange('ingredient')"
              >
                Por Insumo
              </button>
              <button
                type="button"
                class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                [class.bg-[var(--color-bg-primary)]]="groupBy() === 'dish'"
                [class.text-[var(--color-text-primary)]]="groupBy() === 'dish'"
                [class.shadow-sm]="groupBy() === 'dish'"
                [class.text-[var(--color-text-secondary)]]="groupBy() !== 'dish'"
                (click)="onGroupByChange('dish')"
              >
                Por Plato
              </button>
            </div>
          </div>

          <!-- Controls: OptionsDropdown -->
          <div class="flex items-end gap-2 flex-wrap shrink-0">
            <app-options-dropdown
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
          <!-- 3. Charts Grid -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <!-- Top Insumos Bar Chart -->
            <app-card shadow="none" [responsivePadding]="true">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Top Insumos por Costo
                </span>
                <span class="text-xs text-text-secondary">Mayor impacto económico</span>
              </div>
              <div class="h-[320px]">
                @if (loading()) {
                  <div class="h-full flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (rows().length === 0) {
                  <div class="h-full flex flex-col items-center justify-center text-text-secondary">
                    <app-icon name="package-open" [size]="40" class="mb-2 opacity-50"></app-icon>
                    <p class="text-xs">Sin datos de consumo en el período</p>
                  </div>
                } @else {
                  <app-chart [options]="topIngredientsChartOptions()"></app-chart>
                }
              </div>
            </app-card>

            <!-- Distribution by Dish Donut Chart -->
            <app-card shadow="none" [responsivePadding]="true">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Distribución de Costo por Plato
                </span>
                <span class="text-xs text-text-secondary">Platos con mayor gasto de insumos</span>
              </div>
              <div class="h-[320px]">
                @if (loading()) {
                  <div class="h-full flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (rows().length === 0) {
                  <div class="h-full flex flex-col items-center justify-center text-text-secondary">
                    <app-icon name="pie-chart" [size]="40" class="mb-2 opacity-50"></app-icon>
                    <p class="text-xs">Sin datos para graficar</p>
                  </div>
                } @else {
                  <app-chart [options]="dishesDistributionChartOptions()"></app-chart>
                }
              </div>
            </app-card>
          </div>

          <!-- 4. Data Table -->
          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
            <div slot="header" class="results-header flex items-center justify-between">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">
                Detalle Consolidado de Consumo
              </span>
              <span class="text-xs text-text-secondary">
                {{ paginatedData().length }} de {{ rows().length }} filas
              </span>
            </div>

            <div class="p-4 space-y-4">
              <app-responsive-data-view
                [data]="paginatedData()"
                [columns]="tableColumns"
                [cardConfig]="cardConfig()"
                [loading]="loading()"
                [striped]="true"
                tableSize="sm"
                emptyMessage="No se registraron consumos de insumos para este rango de fechas"
                emptyIcon="utensils"
              ></app-responsive-data-view>

              @if (!loading() && rows().length > itemsPerPage()) {
                <div class="mt-4 flex justify-center">
                  <app-pagination
                    [currentPage]="currentPage()"
                    [totalPages]="totalPages()"
                    [total]="rows().length"
                    [limit]="itemsPerPage()"
                    infoStyle="range"
                    (pageChange)="onPageChange($event)"
                  ></app-pagination>
                </div>
              }
            </div>
          </app-card>
        </div>
      </app-card>

      <!-- 5. Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Inventario</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of inventoryViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class IngredientConsumptionComponent implements OnInit, Refreshable {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly analyticsRefresh = inject(AnalyticsRefreshService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    effect(() => {
      const count = this.analyticsRefresh.refreshSignal();
      if (count > 0) {
        untracked(() => this.loadData());
      }
    });
  }

  // State
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly groupBy = signal<'ingredient' | 'dish'>('ingredient');
  readonly rows = signal<IngredientConsumptionAnalyticsRow[]>([]);
  readonly metaTotals = signal({
    total_cost: 0,
    total_ingredients: 0,
    total_dishes: 0,
    total_movements: 0,
  });

  // Pagination
  readonly currentPage = signal(1);
  readonly itemsPerPage = signal(15);

  readonly paginatedData = computed(() => {
    const all = this.rows();
    const page = this.currentPage();
    const limit = this.itemsPerPage();
    const start = (page - 1) * limit;
    return all.slice(start, start + limit);
  });

  readonly totalPages = computed(() =>
    Math.ceil(this.rows().length / this.itemsPerPage()) || 1,
  );

  // Filters
  readonly dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  readonly totalCostFormatted = computed(() =>
    this.currencyService.format(this.metaTotals().total_cost),
  );

  // Charts options
  readonly topIngredientsChartOptions = signal<EChartsOption>({});
  readonly dishesDistributionChartOptions = signal<EChartsOption>({});

  // Quick Links
  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_ingredient_consumption',
  );

  // Table Columns
  readonly tableColumns: TableColumn[] = [
    { key: 'ingredient_name', label: 'Insumo / Ingrediente', sortable: true, priority: 1 },
    { key: 'dish_name', label: 'Plato / Preparación', sortable: true, priority: 1 },
    {
      key: 'dish_quantity',
      label: 'Platos Elab.',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (val) => Number(val || 0).toLocaleString('es-CO'),
    },
    {
      key: 'consumed_quantity',
      label: 'Cant. Consumida',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val, row) =>
        `${Number(val || 0).toLocaleString('es-CO')} ${row?.unit || ''}`.trim(),
    },
    {
      key: 'unit_cost',
      label: 'Costo Unit.',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (val) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'total_cost',
      label: 'Costo Total',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'orders_count',
      label: 'Órdenes',
      sortable: true,
      align: 'center',
      priority: 2,
    },
  ];

  readonly cardConfig = computed<ItemListCardConfig>(() => {
    const isDish = this.groupBy() === 'dish';
    return {
      titleKey: isDish ? 'dish_name' : 'ingredient_name',
      subtitleKey: isDish ? 'ingredient_name' : 'dish_name',
      descriptionKey: 'consumed_quantity',
      amountKey: 'total_cost',
    };
  });

  // Dropdown configs
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'date_range',
      type: 'date-range',
      label: 'Período',
    },
  ]);

  readonly dropdownFilterValues = computed<FilterValues>(() => {
    const dr = this.dateRange();
    return {
      date_range_start: dr?.start_date ?? null,
      date_range_end: dr?.end_date ?? null,
      date_range_preset: (dr?.preset ?? null) as string | null,
    };
  });

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.loadData();
  }

  refresh(): void {
    this.loadData();
  }

  onGroupByChange(groupBy: 'ingredient' | 'dish'): void {
    if (this.groupBy() === groupBy) return;
    this.groupBy.set(groupBy);
    this.currentPage.set(1);
    this.loadData();
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'] as string | null;
    const end = values['date_range_end'] as string | null;
    const preset = values['date_range_preset'] as string | null;

    if (!start || !end) return;

    this.dateRange.set({
      start_date: start,
      end_date: end,
      preset: (preset ?? undefined) as DateRangeFilter['preset'],
    });
    this.currentPage.set(1);
    this.loadData();
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.currentPage.set(1);
    this.loadData();
  }

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  loadData(): void {
    this.loading.set(true);
    const query: InventoryAnalyticsQueryDto = {
      date_range: this.dateRange(),
      group_by: this.groupBy(),
    };

    this.analyticsService
      .getIngredientConsumption(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.rows.set(rows);
          if (response.meta && (response.meta as any).totals) {
            this.metaTotals.set((response.meta as any).totals);
          } else {
            // Fallback calculation
            const totalCost = rows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
            const ingredients = new Set(rows.map((r) => r.ingredient_id)).size;
            const dishes = new Set(rows.map((r) => r.dish_id).filter((id): id is number => id !== null)).size;
            const movements = rows.reduce((s, r) => s + (Number(r.orders_count) || 0), 0);
            this.metaTotals.set({
              total_cost: totalCost,
              total_ingredients: ingredients,
              total_dishes: dishes,
              total_movements: movements,
            });
          }
          this.updateCharts(rows);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar datos de consumo de insumos');
          this.rows.set([]);
          this.metaTotals.set({
            total_cost: 0,
            total_ingredients: 0,
            total_dishes: 0,
            total_movements: 0,
          });
          this.loading.set(false);
        },
      });
  }

  private updateCharts(rows: IngredientConsumptionAnalyticsRow[]): void {
    if (!rows || rows.length === 0) {
      this.topIngredientsChartOptions.set({});
      this.dishesDistributionChartOptions.set({});
      return;
    }

    // Chart 1: Top Insumos por Costo
    const ingredientCostMap = new Map<string, number>();
    for (const r of rows) {
      const current = ingredientCostMap.get(r.ingredient_name) ?? 0;
      ingredientCostMap.set(r.ingredient_name, current + (Number(r.total_cost) || 0));
    }

    const sortedIngredients = Array.from(ingredientCostMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    this.topIngredientsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `<b>${p.name}</b><br/>Costo: ${this.currencyService.format(p.value)}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sortedIngredients.map(([name]) => name),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: {
          color: '#6b7280',
          fontSize: 11,
          formatter: (val: string) => truncateLabel(val, 12),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          fontSize: 11,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Costo Insumo',
          type: 'bar',
          data: sortedIngredients.map(([, cost]) => cost),
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 36,
        },
      ],
    });

    // Chart 2: Top Platos por Costo de Insumos (Donut)
    const dishCostMap = new Map<string, number>();
    for (const r of rows) {
      const name = r.dish_name || 'Sin especificar';
      const current = dishCostMap.get(name) ?? 0;
      dishCostMap.set(name, current + (Number(r.total_cost) || 0));
    }

    const sortedDishes = Array.from(dishCostMap.entries()).sort((a, b) => b[1] - a[1]);
    const topDishes = sortedDishes.slice(0, 5).map(([name, value]) => ({ name, value }));
    const othersValue = sortedDishes.slice(5).reduce((acc, [, val]) => acc + val, 0);
    if (othersValue > 0) {
      topDishes.push({ name: 'Otros platos', value: othersValue });
    }

    this.dishesDistributionChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) =>
          `<b>${p.name}</b><br/>Costo Insumos: ${this.currencyService.format(p.value)} (${p.percent}%)`,
      },
      legend: {
        orient: 'horizontal',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: '#6b7280', fontSize: 11 },
        formatter: (name: string) => truncateLabel(name, 15),
      },
      series: [
        {
          name: 'Platos',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 12,
              fontWeight: 'bold',
            },
          },
          data: topDishes,
        },
      ],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportIngredientConsumption({
        date_range: this.dateRange(),
        group_by: this.groupBy(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `consumo_insumos_${new Date().toISOString().split('T')[0]}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.toastService.success('Reporte exportado correctamente');
        },
        error: () => {
          this.toastService.error('Error al exportar el reporte');
          this.exporting.set(false);
        },
      });
  }
}
