import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

import {
  ResponsiveDataViewComponent,
  IconComponent,
  OptionsDropdownComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
  TableAction,
  SortDirection,
} from '../../../../../../shared/components';
import type {
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { Supplier } from '../../../inventory/interfaces/inventory.interface';

import { LowStockBySupplierRow } from '../../interfaces/low-stock-by-supplier-row.interface';
import { LowStockBySupplierAnalyticsEnvelope } from '../../../analytics/interfaces/low-stock-by-supplier-analytics.interface';

/**
 * Stock status filter — mirrors the backend's `LowStockStatusFilter` enum.
 * `'all'` is rendered as "Todos" and forwarded as no `status` query param.
 */
type StatusFilter = 'all' | 'low_stock' | 'out_of_stock';

/** Default page size for the rows table (server-side paginated). */
const DEFAULT_LIMIT = 25;

/**
 * Cap of the active-inventory product universe used by the backend. When the
 * universe hits this cap, the rows endpoint may be truncated. Mirror of
 * `InventoryAnalyticsService.LOW_STOCK_EXPORT_CAP` in
 * `apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts`
 * — keep the two in sync. The frontend uses this constant to render a
 * "Mostrando los primeros N — refina filtros o exporta el XLSX" banner when
 * `totalItems()` reaches the cap (Major R2-M3).
 */
const LOW_STOCK_EXPORT_CAP = 10000;

/**
 * Custom page for the "Stock Bajo por Proveedor" report (CP-low-stock-by-supplier).
 *
 * Why custom (and NOT the generic viewer):
 * - The supplier filter needs an in-memory search dropdown (the generic
 *   viewer only knows about `date_from`/`date_to`/`fiscal_period_id`).
 * - The status filter is restricted to the report's two buckets plus
 *   an "all" escape, which the generic viewer doesn't expose.
 * - Stats and rows share query params that the user expects to persist
 *   together (drill-down from analytics → report, FB-07).
 *
 * Data flow:
 * - `GET /store/analytics/inventory/low-stock-by-supplier?…&page=&limit=`
 *   for rows (paginated).
 * - `GET /store/analytics/inventory/low-stock-by-supplier/analytics?…`
 *   for the 4 KPI cards (envelope is `LowStockBySupplierAnalyticsEnvelope`).
 * - `GET /store/analytics/inventory/low-stock-by-supplier/export?…`
 *   for the XLSX download (re-uses the SAME filter params).
 *
 * Filter params (`supplier_id`, `category_id`, `status`, `page`) are
 * mirrored into the URL query string so the deep-link from analytics
 * chart → report survives a refresh.
 */
@Component({
  selector: 'app-inventory-low-stock-by-supplier',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    CurrencyPipe,
    IconComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  templateUrl: './inventory-low-stock-by-supplier.component.html',
  styleUrls: ['./inventory-low-stock-by-supplier.component.scss'],
})
export class InventoryLowStockBySupplierComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastService = inject(ToastService);
  private readonly suppliersService = inject(SuppliersService);

  // ─── Filter signals ────────────────────────────────────────────────────────

  readonly supplierId = signal<number | null>(null);
  /**
   * Major R2-M7 — separate from `supplierId` because the visible
   * selector stays on "Todos los proveedores" while the backend filter
   * is "supplier_id IS NULL". We surface the active filter with a
   * chip so the user can clear it.
   */
  readonly withoutSupplier = signal<boolean>(false);
  readonly categoryId = signal<number | null>(null);
  readonly status = signal<StatusFilter>('all');
  readonly page = signal<number>(1);
  readonly limit = signal<number>(DEFAULT_LIMIT);

  /**
   * Server-side sort state (Major R2-M1). The `TableComponent` emits the
   * tri-state sort cycle (asc → desc → null) via `(sort)`. The handler
   * resets `page` to 1 so a sort never lands on a now-empty page.
   *
   * The backend DTO does NOT yet accept `sort_by`/`sort_order` — until it
   * does, the screen sort is a visual hint that the rows stay in the
   * server-side default order. The export still mirrors the active state
   * so pantalla == archivo (vendix-report-xlsx contract).
   */
  readonly sortBy = signal<string | null>(null);
  readonly sortOrder = signal<SortDirection>(null);

  // ─── Data signals ──────────────────────────────────────────────────────────

  readonly rows = signal<LowStockBySupplierRow[]>([]);
  readonly envelope = signal<LowStockBySupplierAnalyticsEnvelope | null>(null);
  readonly loadingRows = signal<boolean>(false);
  readonly loadingKpis = signal<boolean>(false);
  readonly exporting = signal<boolean>(false);
  readonly totalItems = signal<number>(0);
  readonly totalPages = signal<number>(0);

  readonly suppliers = signal<Supplier[]>([]);
  readonly loadingSuppliers = signal<boolean>(false);
  /**
   * Surfaces a non-fatal load failure for the supplier dropdown so the
   * template can distinguish "no hay proveedores activos" (genuine empty
   * state) from "no pudimos cargar la lista" (transport error). Set when
   * `loadSuppliers()`'s HTTP call rejects; cleared on the next attempt.
   */
  readonly suppliersLoadError = signal<boolean>(false);

  // ─── Static config ─────────────────────────────────────────────────────────

  readonly statusOptions: SelectorOption[] = [
    { value: 'all', label: 'Todos' },
    { value: 'low_stock', label: 'Bajo Stock' },
    { value: 'out_of_stock', label: 'Sin Stock' },
  ];

  /**
   * Selector-friendly supplier options. `SelectorComponent` filters
   * internally by its own search term, so we just hand it the full list
   * and the dropdown does the substring match on `label`.
   */
  readonly supplierOptions = computed<SelectorOption[]>(() =>
    this.suppliers().map((s) => ({
      value: s.id,
      label: s.name,
      description: s.code,
    })),
  );

  /**
   * Selector-friendly category options. Derived from the analytics
   * envelope's `by_category` once it loads — no extra round-trip.
   */
  readonly categoryOptions = computed<SelectorOption[]>(() => {
    const list = this.envelope()?.by_category ?? [];
    return list
      .filter((c) => c.category_id !== null)
      .map((c) => ({
        value: c.category_id as number,
        label: c.category_name,
      }));
  });

  /**
   * Major R2-M3 — truncation banner. The screen endpoint does NOT emit a
   * `truncated` flag yet, so we approximate by comparing `totalItems()`
   * against the known cap (`LOW_STOCK_EXPORT_CAP`). When the rows endpoint
   * starts emitting `meta.truncated`, switch this check to read it.
   */
  readonly showTruncationBanner = computed<boolean>(() => {
    const total = this.totalItems();
    return total > 0 && total >= LOW_STOCK_EXPORT_CAP;
  });

  /**
   * Major R2-M5 — render the `cost_coverage` warning under the
   * "Valor en Riesgo" card. Mirrors the
   * `overview-summary.component.ts` `incompleteCostText` pattern: when
   * `coverage_ratio < 1` we tell the buyer how many units of the "value at
   * risk" are unauditable.
   */
  readonly costCoverageWarning = computed<string>(() => {
    const coverage = this.envelope()?.cost_coverage;
    if (!coverage || coverage.units_without_cost === 0) return '';
    const known = coverage.units_total - coverage.units_without_cost;
    const pct = (coverage.coverage_ratio * 100).toFixed(0);
    return `${known} de ${coverage.units_total} con costo conocido (${pct}%). El valor en riesgo puede estar subestimado hasta registrar el costo faltante.`;
  });

  readonly columns: TableColumn[] = [
    {
      key: 'product_name',
      label: 'Producto',
      sortable: true,
      priority: 1,
      transform: (val: unknown) => String(val ?? '-'),
    },
    {
      key: 'sku',
      label: 'SKU',
      sortable: true,
      priority: 2,
      width: '110px',
      transform: (val: unknown) => (val ? String(val) : '-'),
    },
    {
      key: 'supplier_name',
      label: 'Proveedor',
      sortable: true,
      priority: 2,
      transform: (val: unknown) => (val ? String(val) : 'Sin proveedor'),
    },
    {
      key: 'current_stock',
      label: 'Stock Actual',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '110px',
      transform: (val: unknown) => Number(val ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'min_threshold',
      label: 'Mínimo',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '100px',
      transform: (val: unknown) => Number(val ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      align: 'center',
      priority: 1,
      width: '120px',
      badgeConfig: {
        type: 'custom',
        colorMap: {
          out_of_stock: '#ef4444',
          low_stock: '#f59e0b',
        },
      },
      transform: (val: unknown) =>
        val === 'out_of_stock' ? 'Sin stock' : 'Bajo stock',
    },
    {
      key: 'last_purchase_date',
      label: 'Última Compra',
      sortable: true,
      priority: 3,
      width: '130px',
      transform: (val: unknown) => {
        if (!val) return '-';
        const d = new Date(String(val));
        if (isNaN(d.getTime())) return String(val);
        // ISO date-only → render with UTC anchor so the day never shifts.
        return d.toLocaleDateString('es-CO', { timeZone: 'UTC' });
      },
    },
    {
      key: 'days_without_sale',
      label: 'Días Sin Venta',
      sortable: true,
      align: 'right',
      priority: 3,
      width: '120px',
      transform: (val: unknown) =>
        val === null || val === undefined ? '∞' : `${val} d`,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        out_of_stock: '#ef4444',
        low_stock: '#f59e0b',
      },
    },
    badgeTransform: (value: unknown) =>
      value === 'out_of_stock' ? 'Sin stock' : 'Bajo stock',
    detailKeys: [
      {
        key: 'current_stock',
        label: 'Stock',
        icon: 'package',
        transform: (v: unknown) => `${Number(v ?? 0).toLocaleString('es-CO')} uds`,
      },
      {
        key: 'min_threshold',
        label: 'Mínimo',
        icon: 'alert-triangle',
        transform: (v: unknown) => `${Number(v ?? 0).toLocaleString('es-CO')}`,
      },
      {
        key: 'supplier_name',
        label: 'Proveedor',
        icon: 'truck',
        transform: (v: unknown) => (v ? String(v) : 'Sin proveedor'),
      },
      {
        key: 'days_without_sale',
        label: 'Sin venta',
        icon: 'clock',
        transform: (v: unknown) =>
          v === null || v === undefined ? '∞' : `${v} días`,
      },
    ],
  };

  // No row-level actions — the report is a "view + drill to PO" surface.
  readonly actions: TableAction[] = [];

  // ─── Header dropdowns (annotations 3 + 4) ──────────────────────────────────

  /**
   * Filter shape consumed by `<app-options-dropdown>` for the
   * "Filtros" trigger. Mirrors the three inline selectors that used to
   * live in the table header (Proveedor, Estado, Categoría).
   *
   * Trade-off: the embedded `<app-selector>` inside `OptionsDropdownComponent`
   * is rendered without `[searchable]="true"`, so the Proveedor filter inside
   * the dropdown behaves as a native `<select>` (no substring search). For
   * the seed dataset (~40 suppliers) this is functional and matches the
   * user's brief that each filter must keep working (change → refresh).
   * The action side does not lose any feature.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'supplier_id',
      label: 'Proveedor',
      type: 'select',
      options: this.supplierOptions(),
      placeholder: 'Todos los proveedores',
      helpText: 'Busca por nombre o código',
      disabled: this.suppliersLoadError(),
    },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: this.statusOptions,
    },
    {
      key: 'category_id',
      label: 'Categoría',
      type: 'select',
      options: this.categoryOptions(),
      placeholder: 'Todas las categorías',
    },
  ]);

  /**
   * Current values for the "Filtros" dropdown. Mirrors the page-level
   * filter signals; the dropdown reads them and the parent's
   * `(filterChange)` handler writes back into the same signals.
   */
  readonly dropdownFilterValues = computed<FilterValues>(() => ({
    supplier_id: this.supplierId() !== null ? String(this.supplierId()) : null,
    status: this.status() === 'all' ? null : this.status(),
    category_id: this.categoryId() !== null ? String(this.categoryId()) : null,
  }));

  /**
   * Actions consumed by `<app-options-dropdown>` for the
   * "Acciones" trigger. Currently only the XLSX export — the page does
   * not have other row-level operations.
   */
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando…' : 'Exportar XLSX',
      icon: 'download',
      action: 'export-xlsx',
      disabled: this.exporting() || this.loadingRows(),
    },
  ]);

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  constructor() {
    // Read query params first so the deep-link from analytics (FB-07)
    // lands in the right state.
    const qp = this.route.snapshot.queryParamMap;
    const supplierId = qp.get('supplier_id');
    const withoutSupplier = qp.get('without_supplier');
    const categoryId = qp.get('category_id');
    const status = qp.get('status');
    const page = qp.get('page');

    if (supplierId && !isNaN(Number(supplierId))) {
      this.supplierId.set(Number(supplierId));
      this.withoutSupplier.set(false);
    } else if (withoutSupplier === 'true' || withoutSupplier === '1') {
      // Major R2-M7: the analytics "Sin proveedor" bucket sends
      // `without_supplier=true`. Keep the supplier dropdown on "Todos"
      // (its default) but flag the active filter so the user can see
      // — and clear — it.
      this.supplierId.set(null);
      this.withoutSupplier.set(true);
    }
    if (categoryId && !isNaN(Number(categoryId))) {
      this.categoryId.set(Number(categoryId));
    }
    if (status === 'low_stock' || status === 'out_of_stock' || status === 'all') {
      this.status.set(status);
    }
    if (page && !isNaN(Number(page))) {
      this.page.set(Math.max(1, Number(page)));
    }

    // Load suppliers + categories in parallel, then refresh both endpoints.
    this.loadSuppliers();
    this.loadCategories();
    this.refresh();
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────

  /**
   * Pull the supplier list once on mount. The dropdown filters in memory
   * via `SelectorComponent`'s built-in search; no extra round-trips.
   *
   * Error handling: a 403 (sin `store:suppliers:read`), 500 (downstream), or
   * network drop used to be invisible — `loadingSuppliers` flipped to false
   * and the empty state read as "no suppliers registered". Now we log to the
   * console and flip `suppliersLoadError` so the template can render a
   * distinct "No pudimos cargar los proveedores. Intenta recargar." banner
   * instead of the genuine empty state.
   */
  loadSuppliers(): void {
    this.loadingSuppliers.set(true);
    this.suppliersLoadError.set(false);
    this.suppliersService
      .getSuppliers({ state: 'active', limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.suppliers.set(res.data ?? []);
          this.loadingSuppliers.set(false);
        },
        error: (err) => {
          this.loadingSuppliers.set(false);
          this.suppliersLoadError.set(true);
          // Loud, not silent: a swallowed error here would mask permission
          // drift or transport breakage behind an "empty list".
          // eslint-disable-next-line no-console
          console.error(
            '[inventory-low-stock-by-supplier] failed to load suppliers',
            err,
          );
        },
      });
  }

  /**
   * Categories are derived from the analytics envelope's `by_category`
   * bucket (see `LowStockBySupplierAnalyticsEnvelope`). No extra
   * round-trip: the picker hydrates as soon as the first `refresh()`
   * resolves.
   */
  private loadCategories(): void {
    // Intentionally a no-op — kept for symmetry with future dedicated
    // categories endpoint. `categoryOptions()` reads from the envelope.
  }

  /**
   * Reload both the rows + the analytics envelope in parallel.
   * Centralized so any filter change funnels through this method.
   */
  refresh(): void {
    const rowsParams = this.buildRowsParams();
    const analyticsParams = this.buildAnalyticsParams();

    this.loadingRows.set(true);
    this.loadingKpis.set(true);

    forkJoin({
      rows: this.http.get<{
        success: boolean;
        data: LowStockBySupplierRow[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(
        `${environment.apiUrl}/store/analytics/inventory/low-stock-by-supplier`,
        { params: rowsParams },
      ),
      analytics: this.http.get<{
        success: boolean;
        data: LowStockBySupplierAnalyticsEnvelope;
      }>(
        `${environment.apiUrl}/store/analytics/inventory/low-stock-by-supplier/analytics`,
        { params: analyticsParams },
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ rows, analytics }) => {
          this.rows.set(rows.data ?? []);
          this.totalItems.set(rows.meta?.total ?? 0);
          this.totalPages.set(rows.meta?.totalPages ?? 0);
          this.envelope.set(analytics.data ?? null);
          this.loadingRows.set(false);
          this.loadingKpis.set(false);
          this.syncQueryParams();
        },
        error: (err) => {
          this.loadingRows.set(false);
          this.loadingKpis.set(false);
          const msg =
            err?.error?.message ?? 'No se pudo cargar el reporte de stock bajo por proveedor.';
          this.toastService.error(msg);
        },
      });
  }

  /**
   * Build the rows-endpoint query params. Mirrors the backend DTO
   * (`LowStockBySupplierQueryDto`).
   */
  private buildRowsParams(): HttpParams {
    let params = new HttpParams()
      .set('page', String(this.page()))
      .set('limit', String(this.limit()));
    const supplierId = this.supplierId();
    if (supplierId !== null) {
      params = params.set('supplier_id', String(supplierId));
    } else if (this.withoutSupplier()) {
      // Major R2-M7: drill-down from the "Sin proveedor" chart bucket.
      // The backend accepts `without_supplier=true` to filter to rows
      // where `supplier_id IS NULL`.
      params = params.set('without_supplier', 'true');
    }
    const categoryId = this.categoryId();
    if (categoryId !== null) {
      params = params.set('category_id', String(categoryId));
    }
    const status = this.status();
    if (status !== 'all') {
      params = params.set('status', status);
    }
    const sortBy = this.sortBy();
    const sortOrder = this.sortOrder();
    if (sortBy && sortOrder) {
      params = params.set('sort_by', sortBy).set('sort_order', sortOrder);
    }
    return params;
  }

  /**
   * Build the analytics-endpoint query params. Excludes `page`/`limit`
   * since the envelope is a single object.
   *
   * Major R2-M4 — forwards `status` so the KPI cards respect the same
   * filter the table shows. Before this fix the cards displayed the
   * full universe while the rows were filtered, which read as a bug.
   */
  private buildAnalyticsParams(): HttpParams {
    let params = new HttpParams();
    const supplierId = this.supplierId();
    if (supplierId !== null) {
      params = params.set('supplier_id', String(supplierId));
    } else if (this.withoutSupplier()) {
      params = params.set('without_supplier', 'true');
    }
    const categoryId = this.categoryId();
    if (categoryId !== null) {
      params = params.set('category_id', String(categoryId));
    }
    const status = this.status();
    if (status !== 'all') {
      params = params.set('status', status);
    }
    return params;
  }

  /**
   * Mirror the active filter state into the URL so a refresh / share
   * / drill-down preserves it.
   */
  private syncQueryParams(): void {
    const queryParams: Record<string, string | null> = {
      supplier_id: this.supplierId() !== null ? String(this.supplierId()) : null,
      without_supplier: this.withoutSupplier() ? 'true' : null,
      category_id: this.categoryId() !== null ? String(this.categoryId()) : null,
      status: this.status() === 'all' ? null : this.status(),
      page: this.page() === 1 ? null : String(this.page()),
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ─── Filter handlers ───────────────────────────────────────────────────────

  onSupplierChange(value: number | string | null): void {
    const next = value === null || value === '' || value === 'null'
      ? null
      : Number(value);
    this.supplierId.set(Number.isFinite(next as number) ? (next as number) : null);
    // Picking any explicit supplier clears the "Sin proveedor" filter —
    // they are mutually exclusive.
    this.withoutSupplier.set(false);
    this.page.set(1);
    this.refresh();
  }

  onStatusChange(value: string | number | null): void {
    const raw = (value ?? 'all') as string;
    const next: StatusFilter =
      raw === 'low_stock' || raw === 'out_of_stock' ? raw : 'all';
    this.status.set(next);
    this.page.set(1);
    this.refresh();
  }

  onCategoryChange(value: number | string | null): void {
    const next = value === null || value === '' || value === 'null'
      ? null
      : Number(value);
    this.categoryId.set(Number.isFinite(next as number) ? (next as number) : null);
    this.page.set(1);
    this.refresh();
  }

  onSearchTermChange(_term: string): void {
    // No-op: `SelectorComponent` filters internally by its own search
    // term. The signature is preserved for symmetry / future use.
  }

  clearSupplier(): void {
    this.supplierId.set(null);
    this.withoutSupplier.set(false);
    this.page.set(1);
    this.refresh();
  }

  // ─── Header dropdown handlers (annotations 3 + 4) ──────────────────────────

  /**
   * `(filterChange)` from the `<app-options-dropdown>` filter trigger.
   * The dropdown emits stringified values; we parse the numeric ones
   * back and route through the same per-filter setters the inline
   * selectors used so deep-link / `syncQueryParams` keep working.
   */
  onFiltersDropdownChange(values: FilterValues): void {
    const rawSupplier = values['supplier_id'];
    const nextSupplier =
      rawSupplier === null || rawSupplier === '' || rawSupplier === undefined
        ? null
        : Number(rawSupplier);
    const supplierChanged =
      (nextSupplier === null && this.supplierId() !== null) ||
      (nextSupplier !== null && nextSupplier !== this.supplierId());

    const rawStatus = values['status'];
    const nextStatus: StatusFilter =
      rawStatus === 'low_stock' || rawStatus === 'out_of_stock'
        ? rawStatus
        : 'all';
    const statusChanged = nextStatus !== this.status();

    const rawCategory = values['category_id'];
    const nextCategory =
      rawCategory === null || rawCategory === '' || rawCategory === undefined
        ? null
        : Number(rawCategory);
    const categoryChanged =
      (nextCategory === null && this.categoryId() !== null) ||
      (nextCategory !== null && nextCategory !== this.categoryId());

    if (!supplierChanged && !statusChanged && !categoryChanged) {
      return;
    }

    if (supplierChanged) {
      this.supplierId.set(
        Number.isFinite(nextSupplier as number) ? (nextSupplier as number) : null,
      );
      // Any explicit supplier clears the mutually exclusive
      // "Sin proveedor" filter.
      this.withoutSupplier.set(false);
    }
    if (statusChanged) {
      this.status.set(nextStatus);
    }
    if (categoryChanged) {
      this.categoryId.set(
        Number.isFinite(nextCategory as number) ? (nextCategory as number) : null,
      );
    }

    this.page.set(1);
    this.refresh();
  }

  /**
   * "(clearAllFilters)" from the dropdown — parent owns the reset to
   * keep `syncQueryParams` and the deep-link URL in sync.
   */
  onFiltersDropdownClearAll(): void {
    this.supplierId.set(null);
    this.withoutSupplier.set(false);
    this.categoryId.set(null);
    this.status.set('all');
    this.page.set(1);
    this.refresh();
  }

  /**
   * `(actionClick)` from the `<app-options-dropdown>` actions trigger.
   * Currently only 'export-xlsx' is wired; the dispatch table leaves
   * room for future actions without template churn.
   */
  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportXlsx();
    }
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.refresh();
  }

  /**
   * Major R2-M1 — wires `(sort)` from the responsive data view / table.
   * Updates sortBy/sortOrder signals, resets `page` to 1 so a sort never
   * lands on an empty page, and triggers a fresh fetch.
   */
  onSortChange(event: { column: string; direction: SortDirection }): void {
    this.sortBy.set(event.direction ? event.column : null);
    this.sortOrder.set(event.direction);
    this.page.set(1);
    this.refresh();
  }

  // ─── KPI helpers (read from envelope, render with stats-component) ─────────

  getTotalLowStock(): number {
    return this.envelope()?.kpis.total_low_stock ?? 0;
  }

  getTotalValueAtRisk(): number {
    return this.envelope()?.kpis.total_value_at_risk ?? 0;
  }

  getProductsWithoutSupplier(): number {
    return this.envelope()?.kpis.products_without_supplier ?? 0;
  }

  getAvgDaysWithoutSale(): string {
    const v = this.envelope()?.kpis.avg_days_without_sale;
    return v === null || v === undefined ? '∞' : `${v.toFixed(1)} d`;
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  /**
   * XLSX download — same filter params as the rows endpoint.
   * Uses the analytics service helper so the cache key shape stays
   * consistent with the rest of inventory exports.
   */
  exportXlsx(): void {
    let params = new HttpParams();
    const supplierId = this.supplierId();
    if (supplierId !== null) {
      params = params.set('supplier_id', String(supplierId));
    } else if (this.withoutSupplier()) {
      params = params.set('without_supplier', 'true');
    }
    const categoryId = this.categoryId();
    if (categoryId !== null) {
      params = params.set('category_id', String(categoryId));
    }
    const status = this.status();
    if (status !== 'all') {
      params = params.set('status', status);
    }
    const sortBy = this.sortBy();
    const sortOrder = this.sortOrder();
    if (sortBy && sortOrder) {
      params = params.set('sort_by', sortBy).set('sort_order', sortOrder);
    }

    this.exporting.set(true);
    this.http
      .get(
        `${environment.apiUrl}/store/analytics/inventory/low-stock-by-supplier/export`,
        { params, responseType: 'blob' },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `stock_bajo_por_proveedor_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.toastService.success('Reporte exportado correctamente');
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }
}
