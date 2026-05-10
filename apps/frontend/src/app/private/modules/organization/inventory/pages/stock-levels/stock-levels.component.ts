import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  CardComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown';
import {
  OrgInventoryService,
  OrgStockLevelRow,
} from '../../services/org-inventory.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Niveles de Stock consolidados.
 *
 * Read-only, mobile-first list aligned to the canonical pattern
 * (vendix-frontend-standard-module): sticky stats + sticky search +
 * `app-card [responsive]=true [padding]=false` + ResponsiveDataView.
 *
 * TODO(backend): `getStockLevels` does not yet support `page`/`limit` or
 * `location_id` query params. Pagination is computed client-side and the
 * location filter is also derived from the loaded dataset. Switch to
 * server-side pagination/filters once the endpoint is extended.
 */
@Component({
  selector: 'vendix-org-stock-levels',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total SKUs"
          [value]="stats().total"
          smallText="Productos en stock"
          iconName="boxes"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        />

        <app-stats
          title="Disponible"
          [value]="stats().available"
          smallText="Unidades disponibles"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        />

        <app-stats
          title="Reservado"
          [value]="stats().reserved"
          smallText="Unidades reservadas"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
        />

        <app-stats
          title="Sin stock"
          [value]="stats().outOfStock"
          smallText="SKUs en cero"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el stock">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <!-- Search + Filters: sticky below stats on mobile, normal on desktop -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Niveles de stock ({{ filteredItems().length }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar producto, tienda o ubicación..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
              />
            </div>
          </div>

        </div>

        <!-- Loading State -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando niveles de stock...</p>
          </div>
        }

        <!-- Table / Cards -->
        @if (!loading()) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="paginatedItems()"
              [columns]="tableColumns"
              [cardConfig]="cardConfig"
              [actions]="tableActions"
              [loading]="loading()"
              [sortable]="true"
              emptyTitle="Sin niveles de stock"
              emptyMessage="Sin niveles de stock"
              emptyDescription="Aún no hay productos registrados con stock."
              emptyIcon="boxes"
              [showEmptyAction]="false"
              [showEmptyClearFilters]="hasActiveFilters()"
              (sort)="onSort($event)"
              (emptyClearFiltersClick)="clearFilters()"
            />

            @if (totalPages() > 1) {
              <div class="mt-4 flex justify-center">
                <app-pagination
                  [currentPage]="page()"
                  [totalPages]="totalPages()"
                  [total]="filteredItems().length"
                  [limit]="limit()"
                  infoStyle="none"
                  (pageChange)="changePage($event)"
                />
              </div>
            }
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgStockLevelsComponent {
  private readonly service = inject(OrgInventoryService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── Source data ─────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly items = signal<OrgStockLevelRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  // ─── Filters ─────────────────────────────────────────────────────────────
  readonly searchTerm = signal('');
  readonly storeFilter = signal<number | null>(null);
  readonly locationFilter = signal<number | null>(null);
  readonly onlyOutOfStock = signal(false);
  readonly filterValues = signal<FilterValues>({});

  /**
   * Filter options derived from the loaded dataset (client-side until the
   * backend exposes them as dedicated endpoints/params).
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const list = this.items();

    const stores = new Map<number, string>();
    const locations = new Map<number, string>();
    for (const r of list) {
      if (r.store_id != null && !stores.has(r.store_id)) {
        stores.set(r.store_id, r.store_name ?? `Tienda #${r.store_id}`);
      }
      if (r.location_id != null && !locations.has(r.location_id)) {
        locations.set(
          r.location_id,
          r.location_name ?? `Ubicación #${r.location_id}`,
        );
      }
    }

    return [
      {
        key: 'store_id',
        label: 'Tienda',
        type: 'select',
        options: [
          { value: '', label: 'Todas las tiendas' },
          ...Array.from(stores.entries()).map(([id, name]) => ({
            value: String(id),
            label: name,
          })),
        ],
      },
      {
        key: 'location_id',
        label: 'Ubicación',
        type: 'select',
        options: [
          { value: '', label: 'Todas las ubicaciones' },
          ...Array.from(locations.entries()).map(([id, name]) => ({
            value: String(id),
            label: name,
          })),
        ],
      },
      {
        key: 'only_out_of_stock',
        label: 'Disponibilidad',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          { value: 'true', label: 'Solo sin stock' },
        ],
      },
    ];
  });

  // ─── Pagination (client-side) ────────────────────────────────────────────
  readonly page = signal(1);
  readonly limit = signal(25);

  readonly filteredItems = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const storeId = this.storeFilter();
    const locationId = this.locationFilter();
    const onlyOos = this.onlyOutOfStock();

    return this.items().filter((row) => {
      if (storeId != null && row.store_id !== storeId) return false;
      if (locationId != null && row.location_id !== locationId) return false;
      if (onlyOos && this.asNumber(row.available_quantity) > 0) return false;

      if (term) {
        const haystack = [
          row.product_name,
          row.variant_name,
          row.store_name,
          row.location_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  });

  readonly totalPages = computed(() => {
    const total = this.filteredItems().length;
    const lim = this.limit();
    return lim > 0 ? Math.max(1, Math.ceil(total / lim)) : 1;
  });

  readonly paginatedItems = computed(() => {
    const all = this.filteredItems();
    const lim = this.limit();
    const currentPage = Math.min(this.page(), this.totalPages());
    const start = (currentPage - 1) * lim;
    return all.slice(start, start + lim);
  });

  // ─── Stats ───────────────────────────────────────────────────────────────
  readonly stats = computed(() => {
    const list = this.items();
    let available = 0;
    let reserved = 0;
    let outOfStock = 0;

    for (const row of list) {
      available += this.asNumber(row.available_quantity);
      reserved += this.asNumber(row.reserved_quantity);
      if (this.asNumber(row.available_quantity) <= 0) outOfStock++;
    }

    return {
      total: list.length,
      available,
      reserved,
      outOfStock,
    };
  });

  readonly hasActiveFilters = computed(
    () =>
      !!this.searchTerm() ||
      this.storeFilter() != null ||
      this.locationFilter() != null ||
      this.onlyOutOfStock(),
  );

  // ─── Table columns (desktop) ─────────────────────────────────────────────
  readonly tableColumns: TableColumn[] = [
    {
      key: 'product_name',
      label: 'Producto',
      sortable: true,
      priority: 1,
      transform: (value, item) =>
        value || (item?.product_id ? `#${item.product_id}` : '—'),
    },
    {
      key: 'variant_name',
      label: 'Variante',
      priority: 3,
      transform: (value) => value || '—',
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value) => value || '—',
    },
    {
      key: 'location_name',
      label: 'Ubicación',
      priority: 3,
      transform: (value) => value || '—',
    },
    {
      key: 'quantity',
      label: 'Cantidad',
      align: 'right',
      priority: 2,
      transform: (value) => String(this.asNumber(value)),
    },
    {
      key: 'reserved_quantity',
      label: 'Reservado',
      align: 'right',
      priority: 3,
      transform: (value) => String(this.asNumber(value)),
    },
    {
      key: 'available_quantity',
      label: 'Disponible',
      align: 'right',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorFn: (value) =>
          this.asNumber(value) <= 0 ? '#ef4444' : '#22c55e',
      },
      badgeTransform: (value) => String(this.asNumber(value)),
    },
  ];

  // Read-only by design.
  readonly tableActions = [];

  // ─── Mobile card config ──────────────────────────────────────────────────
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    titleTransform: (item: OrgStockLevelRow) =>
      item.product_name || (item.product_id ? `#${item.product_id}` : '—'),
    subtitleKey: 'variant_name',
    subtitleTransform: (item: OrgStockLevelRow) => item.variant_name || '',
    avatarFallbackIcon: 'boxes',
    avatarShape: 'square',
    badgeKey: 'available_quantity',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorFn: (value) => (this.asNumber(value) <= 0 ? '#ef4444' : '#22c55e'),
    },
    badgeTransform: (value) => String(this.asNumber(value)),
    footerKey: 'store_name',
    footerLabel: 'Tienda',
    footerTransform: (value) => String(value || '—'),
    detailKeys: [
      {
        key: 'location_name',
        label: 'Ubicación',
        icon: 'map-pin',
        transform: (value) => String(value || '—'),
      },
      {
        key: 'quantity',
        label: 'Total',
        transform: (value) => String(this.asNumber(value)),
      },
      {
        key: 'reserved_quantity',
        label: 'Reservado',
        transform: (value) => String(this.asNumber(value)),
      },
    ],
  };

  constructor() {
    this.loadStockLevels();
  }

  // ─── Data loading ────────────────────────────────────────────────────────
  private loadStockLevels(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.service
      .getStockLevels()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgStockLevels] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el stock.'),
          );
          this.loading.set(false);
        },
      });
  }

  // ─── Event handlers ──────────────────────────────────────────────────────
  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.page.set(1);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);

    const storeRaw = values['store_id'];
    const locationRaw = values['location_id'];
    const oosRaw = values['only_out_of_stock'];

    this.storeFilter.set(this.parseIdValue(storeRaw));
    this.locationFilter.set(this.parseIdValue(locationRaw));
    this.onlyOutOfStock.set(oosRaw === 'true');
    this.page.set(1);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.storeFilter.set(null);
    this.locationFilter.set(null);
    this.onlyOutOfStock.set(false);
    this.filterValues.set({});
    this.page.set(1);
  }

  changePage(page: number): void {
    this.page.set(page);
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      // Restore original server order.
      this.loadStockLevels();
      return;
    }

    const dir = event.direction;
    const col = event.column;

    this.items.update((list) =>
      [...list].sort((a, b) => {
        const va = (a as unknown as Record<string, unknown>)[col];
        const vb = (b as unknown as Record<string, unknown>)[col];

        const na = this.maybeNumber(va);
        const nb = this.maybeNumber(vb);
        if (na !== null && nb !== null) {
          return dir === 'asc' ? na - nb : nb - na;
        }

        const sa = String(va ?? '').toLowerCase();
        const sb = String(vb ?? '').toLowerCase();
        const cmp = sa.localeCompare(sb);
        return dir === 'asc' ? cmp : -cmp;
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  private asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  private maybeNumber(v: unknown): number | null {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
      return Number(v);
    }
    return null;
  }

  private parseIdValue(raw: string | string[] | null | undefined): number | null {
    if (raw == null) return null;
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (!first) return null;
      const n = Number(first);
      return isNaN(n) ? null : n;
    }
    if (raw === '') return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  }
}
