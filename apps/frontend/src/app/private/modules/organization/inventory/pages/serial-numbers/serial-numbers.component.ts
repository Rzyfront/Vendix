import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  AlertBannerComponent,
  CardComponent,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';
import {
  OrgSerialNumberRow,
  OrgSerialNumberStatus,
} from '../../services/org-inventory.service';
import {
  OrgSerialNumberListQuery,
  OrgSerialNumbersService,
} from '../../services/org-serial-numbers.service';

interface SerialStats {
  total: number;
  in_stock: number;
  sold: number;
  defective: number;
}

interface StoreOption {
  value: number;
  label: string;
}

const STATUS_LABELS: Record<string, string> = {
  in_stock: 'En stock',
  reserved: 'Reservado',
  sold: 'Vendido',
  returned: 'Devuelto',
  damaged: 'Dañado',
  expired: 'Vencido',
  in_transit: 'En tránsito',
};

const STATUS_COLOR_MAP: Record<string, string> = {
  in_stock: '#22c55e',
  reserved: '#0ea5e9',
  sold: '#6366f1',
  returned: '#a855f7',
  damaged: '#ef4444',
  expired: '#f97316',
  in_transit: '#3b82f6',
};

const DEFECTIVE_STATUSES = new Set(['damaged', 'expired']);

const PAGE_LIMIT_DEFAULT = 25;

/**
 * ORG_ADMIN — Listado consolidado de números de serie de inventario.
 *
 * Read-only org-wide. Stats con totales por estado. Filtros: search por
 * serial, estado, tienda. Paginación server-side.
 */
@Component({
  selector: 'vendix-org-serial-numbers',
  standalone: true,
  imports: [
    FormsModule,
    CardComponent,
    AlertBannerComponent,
    EmptyStateComponent,
    StatsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Series registradas"
          iconName="hash"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        />
        <app-stats
          title="En stock"
          [value]="stats().in_stock"
          smallText="Disponibles"
          iconName="package"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        />
        <app-stats
          title="Vendidas"
          [value]="stats().sold"
          smallText="Salieron del inventario"
          iconName="shopping-cart"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-500"
        />
        <app-stats
          title="Defectuosas"
          [value]="stats().defective"
          smallText="Dañadas o vencidas"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner
          variant="danger"
          title="No se pudieron cargar los números de serie"
        >
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <!-- Search/Filters -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Números de serie ({{ totalRecords() }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por serial..."
                [debounceTime]="500"
                [ngModel]="searchTerm()"
                (ngModelChange)="onSearchChange($event)"
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

        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando números de serie...</p>
          </div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="hash"
            [title]="getEmptyStateTitle()"
            [description]="getEmptyStateDescription()"
            [showActionButton]="false"
            [showClearFilters]="hasFilters()"
            (clearFiltersClick)="clearFilters()"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [actions]="actions"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="true"
            />

            @if (totalPages() > 1) {
              <div class="mt-4 flex justify-center">
                <app-pagination
                  [currentPage]="currentPage()"
                  [totalPages]="totalPages()"
                  [total]="totalRecords()"
                  [limit]="pageLimit"
                  infoStyle="none"
                  (pageChange)="onPageChange($event)"
                />
              </div>
            }
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgSerialNumbersComponent {
  private readonly service = inject(OrgSerialNumbersService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyPipe = new CurrencyPipe();

  // ─── State ─────────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly rows = signal<OrgSerialNumberRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly currentPage = signal(1);
  readonly totalRecords = signal(0);
  readonly storeOptions = signal<StoreOption[]>([]);

  // Stats: derived from a separate "no-pagination" call so the totals reflect
  // the entire org-wide dataset rather than just the visible page.
  readonly statsRows = signal<OrgSerialNumberRow[]>([]);

  readonly pageLimit = PAGE_LIMIT_DEFAULT;

  // ─── Derived state ──────────────────────────────────────────────────────
  readonly stats = computed<SerialStats>(() => {
    const all = this.statsRows();
    let inStock = 0;
    let sold = 0;
    let defective = 0;
    for (const r of all) {
      const s = String(r.status ?? '').toLowerCase();
      if (s === 'in_stock') inStock++;
      else if (s === 'sold') sold++;
      if (DEFECTIVE_STATUSES.has(s)) defective++;
    }
    return {
      total: all.length,
      in_stock: inStock,
      sold,
      defective,
    };
  });

  readonly totalPages = computed(() => {
    const total = this.totalRecords();
    if (total === 0) return 0;
    return Math.max(1, Math.ceil(total / this.pageLimit));
  });

  readonly hasFilters = computed(() => {
    if (this.searchTerm().trim().length > 0) return true;
    const v = this.filterValues();
    if (v['status']) return true;
    if (v['store_id']) return true;
    return false;
  });

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos los estados',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'in_stock', label: 'En stock' },
        { value: 'reserved', label: 'Reservado' },
        { value: 'sold', label: 'Vendido' },
        { value: 'returned', label: 'Devuelto' },
        { value: 'damaged', label: 'Dañado' },
        { value: 'expired', label: 'Vencido' },
        { value: 'in_transit', label: 'En tránsito' },
      ],
    },
    {
      key: 'store_id',
      label: 'Tienda',
      type: 'select',
      placeholder: 'Todas las tiendas',
      options: [
        { value: '', label: 'Todas las tiendas' },
        ...this.storeOptions().map((s) => ({
          value: String(s.value),
          label: s.label,
        })),
      ],
    },
  ]);

  // ─── Table / list configuration ────────────────────────────────────────
  readonly columns: TableColumn[] = [
    {
      key: 'serial_number',
      label: 'Serial',
      sortable: true,
      priority: 1,
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: STATUS_COLOR_MAP,
      },
      badgeTransform: (value: any) => this.formatStatus(value),
    },
    {
      key: 'product_name',
      label: 'Producto',
      sortable: true,
      priority: 1,
      transform: (value: any, item?: OrgSerialNumberRow) =>
        value || (item?.product_id ? `#${item.product_id}` : '—'),
    },
    {
      key: 'variant_name',
      label: 'Variante',
      sortable: true,
      priority: 3,
      transform: (value: any) => value || '—',
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value: any) => value || '—',
    },
    {
      key: 'location_name',
      label: 'Ubicación',
      sortable: true,
      priority: 3,
      transform: (value: any) => value || '—',
    },
    {
      key: 'batch_number',
      label: 'Lote',
      sortable: true,
      priority: 3,
      transform: (value: any) => value || '—',
    },
    {
      key: 'cost',
      label: 'Costo',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (value: any) => this.formatCost(value),
    },
    {
      key: 'sold_date',
      label: 'Fecha venta',
      sortable: true,
      priority: 3,
      transform: (value: any) => this.formatDate(value),
    },
    {
      key: 'warranty_expiry',
      label: 'Garantía vence',
      sortable: true,
      priority: 3,
      transform: (value: any) => this.formatDate(value),
    },
  ];

  readonly actions: TableAction[] = [];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'serial_number',
    titleTransform: (item: any) => item?.serial_number ?? '—',
    subtitleKey: 'product_name',
    subtitleTransform: (item: any) =>
      item?.product_name ||
      (item?.product_id ? `#${item.product_id}` : '—'),
    avatarFallbackIcon: 'hash',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: STATUS_COLOR_MAP,
    },
    badgeTransform: (value: any) => this.formatStatus(value),
    detailKeys: [
      {
        key: 'store_name',
        label: 'Tienda',
        transform: (value: any) => value || '—',
      },
      {
        key: 'location_name',
        label: 'Ubicación',
        icon: 'map-pin',
        transform: (value: any) => value || '—',
      },
      {
        key: 'batch_number',
        label: 'Lote',
        transform: (value: any) => value || '—',
      },
      {
        key: 'cost',
        label: 'Costo',
        transform: (value: any) => this.formatCost(value),
      },
      {
        key: 'warranty_expiry',
        label: 'Garantía',
        transform: (value: any) => this.formatDate(value),
      },
    ],
  };

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  constructor() {
    this.loadStats();
    this.loadStores();
    this.loadPage();
  }

  // ─── Data loading ───────────────────────────────────────────────────────
  private buildQuery(includePagination = true): OrgSerialNumberListQuery {
    const filters = this.filterValues();
    const status = (filters['status'] as string | null) ?? '';
    const storeIdRaw = (filters['store_id'] as string | null) ?? '';
    const search = this.searchTerm().trim();

    const q: OrgSerialNumberListQuery = {
      ...(status ? { status: status as OrgSerialNumberStatus } : {}),
      ...(storeIdRaw ? { store_id: Number(storeIdRaw) } : {}),
      ...(search ? { serial_number: search } : {}),
    };

    if (includePagination) {
      q.page = this.currentPage();
      q.limit = this.pageLimit;
    } else {
      // Stats query — load a generous cap to avoid skewing totals while
      // staying read-only and safe.
      q.page = 1;
      q.limit = 1000;
    }

    return q;
  }

  private loadPage(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .list(this.buildQuery(true))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          const total =
            res?.meta?.total ??
            res?.meta?.pagination?.total ??
            (res?.data?.length ?? 0);
          this.totalRecords.set(total);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgSerialNumbers] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(
              err,
              'No se pudieron cargar los números de serie.',
            ),
          );
          this.loading.set(false);
        },
      });
  }

  private loadStats(): void {
    this.service
      .list(this.buildQuery(false))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.statsRows.set(res?.data ?? []);
        },
        error: (err) => {
          console.error('[OrgSerialNumbers] stats load failed', err);
        },
      });
  }

  private loadStores(): void {
    this.storesService
      .getStores({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = (res?.data ?? []).map((s: any) => ({
            value: Number(s.id),
            label: s.name ?? `Tienda #${s.id}`,
          }));
          this.storeOptions.set(list);
        },
        error: (err) => {
          console.error('[OrgSerialNumbers] stores load failed', err);
        },
      });
  }

  // ─── Event handlers ─────────────────────────────────────────────────────
  onSearchChange(term: string): void {
    this.searchTerm.set(term ?? '');
    this.currentPage.set(1);
    this.loadPage();
    this.loadStats();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.currentPage.set(1);
    this.loadPage();
    this.loadStats();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.currentPage.set(1);
    this.loadPage();
    this.loadStats();
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadPage();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ningún número de serie coincide con los filtros'
      : 'Sin números de serie';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar los términos de búsqueda o los filtros.'
      : 'No hay números de serie registrados a nivel organización.';
  }

  private formatStatus(value: any): string {
    if (!value) return '—';
    const key = String(value).toLowerCase();
    return STATUS_LABELS[key] ?? String(value);
  }

  /**
   * Renders a Decimal-as-string cost using the Vendix CurrencyPipe so the
   * formatting respects tenant locale/currency settings.
   */
  private formatCost(value: any): string {
    if (value === null || value === undefined || value === '') return '—';
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) return '—';
    return this.currencyPipe.transform(n);
  }

  /**
   * Renders date-only fields (`sold_date`, `warranty_expiry`) without
   * timezone drift. The backend returns ISO strings; we only show the
   * day/month/year portion in `es-CO` locale.
   */
  private formatDate(value: any): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
}
