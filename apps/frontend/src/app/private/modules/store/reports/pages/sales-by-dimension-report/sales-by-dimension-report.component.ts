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
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { AnalyticsService } from '../../../analytics/services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../../analytics/interfaces/analytics.interface';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
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
} from '../../../analytics/interfaces/sales-analytics.interface';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { BrandsService } from '../../../products/services/brands.service';

const VIEW_VALUES: SalesDimensionView[] = ['product', 'user', 'customer'];
const PAGE_SIZE = 20;
const EMPTY_SUMMARY: SalesByDimensionSummary = {
  net_sales: 0,
  units: 0,
  orders: 0,
  impacted_customers: 0,
  distinct_references: 0,
};

@Component({
  selector: 'vendix-sales-by-dimension-report',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    StatsComponent,
    IconComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
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
              [isLoading]="exporting()"
              (filterChange)="onFiltersDropdownChange($event)"
              (clearAllFilters)="onClearAllFilters()"
              (actionClick)="onActionsDropdownClick($event)"
            ></app-options-dropdown>
          </div>
        </div>

        <div class="p-4 space-y-4">
          @if (dimension() === 'supplier') {
            <p class="text-xs text-[var(--color-text-secondary)]">
              Las ventas se atribuyen al proveedor asignado al producto o, si no tiene, al de su última orden de compra.
            </p>
          }

          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns()"
            [cardConfig]="cardConfig()"
            [loading]="loading()"
            [emptyIcon]="'bar-chart-2'"
            [emptyTitle]="'Sin ventas en el período'"
            [emptyMessage]="'No hay ventas para los filtros seleccionados.'"
            [emptyDescription]="emptyDescription()"
          ></app-responsive-data-view>

          @if (totalPages() > 1) {
            <div class="flex justify-center pt-2">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="total()"
                [limit]="limit"
                [infoStyle]="'range'"
                (pageChange)="onPageChange($event)"
              ></app-pagination>
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class SalesByDimensionReportComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly suppliersService = inject(SuppliersService);
  private readonly brandsService = inject(BrandsService);

  readonly limit = PAGE_SIZE;

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

  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly rows = signal<SalesByDimensionRow[]>([]);
  readonly summary = signal<SalesByDimensionSummary>(EMPTY_SUMMARY);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(0);

  readonly view = signal<SalesDimensionView>('product');
  readonly selectedIds = signal<string[]>([]);
  readonly dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });
  private readonly entityOptions = signal<{ value: string; label: string }[]>([]);

  readonly netSalesLabel = computed(() =>
    this.currencyService.format(Number(this.summary().net_sales) || 0, 0),
  );

  readonly emptyDescription = computed(() =>
    this.dimension() === 'supplier'
      ? 'Prueba otro período o proveedor. Las ventas se atribuyen al proveedor asignado al producto o, si no tiene, al de su última orden de compra.'
      : 'Prueba otro período o marca.',
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
    { action: 'export-xlsx', label: 'Exportar XLSX', icon: 'download' },
  ]);

  private money = (v: unknown): string =>
    this.currencyService.format(Number(v) || 0, 0);
  private num = (v: unknown): string => String(Number(v) || 0);

  readonly columns = computed<TableColumn[]>(() => {
    const dim: TableColumn = {
      key: 'dimension_name',
      label: this.dimensionLabel(),
      priority: 1,
    };
    const units: TableColumn = { key: 'units', label: 'Unidades', align: 'right', transform: this.num };
    const sales: TableColumn = { key: 'net_sales', label: 'Venta neta', align: 'right', transform: this.money };
    const orders: TableColumn = { key: 'orders', label: 'Órdenes', align: 'right', transform: this.num };
    const customers: TableColumn = { key: 'customers', label: 'Clientes', align: 'right', transform: this.num };
    const references: TableColumn = { key: 'references', label: 'Referencias', align: 'right', transform: this.num };
    switch (this.view()) {
      case 'user':
        return [
          dim,
          { key: 'user_name', label: 'Vendedor' },
          { key: 'user_document', label: 'Documento', defaultValue: '—' },
          units, sales, orders, customers, references,
        ];
      case 'customer':
        return [
          dim,
          { key: 'customer_name', label: 'Cliente' },
          { key: 'customer_document', label: 'Documento', defaultValue: '—' },
          units, sales, orders, references,
        ];
      default:
        return [
          dim,
          {
            key: 'product_name',
            label: 'Producto',
            transform: (_v, item) =>
              item?.variant_name ? `${item.product_name} — ${item.variant_name}` : (item?.product_name ?? ''),
          },
          { key: 'sku', label: 'SKU', defaultValue: '—' },
          units, sales, orders, customers,
        ];
    }
  });

  readonly cardConfig = computed<ItemListCardConfig>(() => {
    const view = this.view();
    const detail = [
      { key: 'dimension_name', label: this.dimensionLabel() },
      { key: 'units', label: 'Unidades', transform: this.num },
      { key: 'orders', label: 'Órdenes', transform: this.num },
    ];
    if (view === 'user') {
      return {
        titleKey: 'user_name',
        subtitleKey: 'user_document',
        footerKey: 'net_sales',
        footerLabel: 'Venta neta',
        footerStyle: 'prominent',
        footerTransform: this.money,
        detailKeys: [...detail, { key: 'customers', label: 'Clientes', transform: this.num }, { key: 'references', label: 'Referencias', transform: this.num }],
      };
    }
    if (view === 'customer') {
      return {
        titleKey: 'customer_name',
        subtitleKey: 'customer_document',
        footerKey: 'net_sales',
        footerLabel: 'Venta neta',
        footerStyle: 'prominent',
        footerTransform: this.money,
        detailKeys: [...detail, { key: 'references', label: 'Referencias', transform: this.num }],
      };
    }
    return {
      titleKey: 'product_name',
      titleTransform: (item) =>
        item?.variant_name ? `${item.product_name} — ${item.variant_name}` : (item?.product_name ?? ''),
      subtitleKey: 'sku',
      footerKey: 'net_sales',
      footerLabel: 'Venta neta',
      footerStyle: 'prominent',
      footerTransform: this.money,
      detailKeys: [...detail, { key: 'customers', label: 'Clientes', transform: this.num }],
    };
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

    const urlView = qp.get('view') as SalesDimensionView | null;
    this.view.set(urlView && VIEW_VALUES.includes(urlView) ? urlView : 'product');

    const urlIds = qp.get('ids');
    this.selectedIds.set(urlIds ? urlIds.split(',').filter((x) => x !== '') : []);

    this.syncDropdownValues();
    this.loadData();
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
    const rawView = values['view'] as SalesDimensionView | null;
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
    this.page.set(1);
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
    this.page.set(1);
    this.syncDropdownValues();
    this.persistQueryParams();
    this.loadData();
  }

  onActionsDropdownClick(action: string): void {
    if (action === 'refresh') {
      this.analyticsService.requestInvalidation();
      this.loadData();
    } else if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.loadData();
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

  private buildQuery(): SalesByDimensionQuery {
    const ids = this.selectedIds();
    return {
      dimension: this.dimension(),
      ids: ids.length ? ids.join(',') : undefined,
      view: this.view(),
      date_range: this.dateRange(),
      page: this.page(),
      limit: PAGE_SIZE,
    };
  }

  private loadData(): void {
    this.loading.set(true);
    this.analyticsService
      .getSalesByDimension(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: SalesByDimensionResponse) => {
          this.rows.set(res.data ?? []);
          this.summary.set(res.meta?.summary ?? EMPTY_SUMMARY);
          this.total.set(res.meta?.total ?? 0);
          this.totalPages.set(res.meta?.totalPages ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.summary.set(EMPTY_SUMMARY);
          this.total.set(0);
          this.totalPages.set(0);
          this.toastService.error(`Error al cargar ${this.title().toLowerCase()}`);
          this.loading.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    const { dimension, ids, date_range } = this.buildQuery();
    this.analyticsService
      .exportSalesByDimension({ dimension, ids, date_range })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ventas-por-${dimension === 'supplier' ? 'proveedor' : 'marca'}_${toLocalDateString()}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error(`Error al exportar ${this.title().toLowerCase()}`);
          this.exporting.set(false);
        },
      });
  }
}
