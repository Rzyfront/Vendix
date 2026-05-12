import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  CardComponent,
  AlertBannerComponent,
  EmptyStateComponent,
  StatsComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/index';

import {
  OrgBatchesService,
  OrgBatchRow,
} from '../../services/org-batches.service';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

interface BatchStats {
  total: number;
  with_stock: number;
  expired: number;
  expiring_soon: number;
}

interface StoreOption {
  value: number;
  label: string;
}

const PAGE_LIMIT_DEFAULT = 25;
const EXPIRING_DAYS_AHEAD = 30;

const EXPIRY_STATUS_COLOR_MAP: Record<string, string> = {
  expired: '#ef4444',
  expiring: '#f59e0b',
  ok: '#22c55e',
  none: '#9ca3af',
};

const EXPIRY_STATUS_LABEL: Record<string, string> = {
  expired: 'Vencido',
  expiring: 'Por vencer',
  ok: 'Vigente',
  none: 'Sin caducidad',
};

/**
 * ORG_ADMIN — Lotes de inventario consolidados (read-only).
 *
 * Listado consolidado org-wide con foco en caducidad. Filtros server-side:
 * search, tienda, "solo con stock", rango de caducidad. Paginación server-side
 * — el backend devuelve `meta.total/page/limit/totalPages`.
 */
@Component({
  selector: 'vendix-org-batches',
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
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Lotes registrados"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        />
        <app-stats
          title="Con stock"
          [value]="stats().with_stock"
          smallText="Disponible para venta"
          iconName="package-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        />
        <app-stats
          title="Por vencer"
          [value]="stats().expiring_soon"
          smallText="Vencen en 30 días"
          iconName="calendar-clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
        />
        <app-stats
          title="Vencidos"
          [value]="stats().expired"
          smallText="Caducados con stock"
          iconName="calendar-x"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner
          variant="danger"
          title="No se pudieron cargar los lotes"
        >
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Lotes ({{ totalRows() }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por número de lote..."
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
            <p class="mt-2 text-text-secondary">Cargando lotes...</p>
          </div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="layers"
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
                  [total]="totalRows()"
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
export class OrgBatchesComponent {
  private readonly service = inject(OrgBatchesService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<OrgBatchRow[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly totalRows = signal(0);

  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly currentPage = signal(1);
  readonly storeOptions = signal<StoreOption[]>([]);

  readonly pageLimit = PAGE_LIMIT_DEFAULT;

  readonly stats = computed<BatchStats>(() => {
    const list = this.rows();
    const now = Date.now();
    const horizon = now + EXPIRING_DAYS_AHEAD * 24 * 60 * 60 * 1000;
    let with_stock = 0;
    let expired = 0;
    let expiring_soon = 0;
    for (const r of list) {
      const available = Number(r.available_quantity ?? 0);
      if (available > 0) with_stock++;
      if (!r.expiration_date) continue;
      const ms = Date.parse(r.expiration_date);
      if (Number.isNaN(ms)) continue;
      if (ms < now && available > 0) expired++;
      else if (ms <= horizon && ms >= now && available > 0) expiring_soon++;
    }
    return {
      total: this.totalRows(),
      with_stock,
      expired,
      expiring_soon,
    };
  });

  readonly totalPages = computed(() => {
    const total = this.totalRows();
    if (total === 0) return 0;
    return Math.max(1, Math.ceil(total / this.pageLimit));
  });

  readonly hasFilters = computed(() => {
    if (this.searchTerm().trim().length > 0) return true;
    const v = this.filterValues();
    if (v['store_id']) return true;
    if (v['has_stock']) return true;
    if (v['expires_before']) return true;
    if (v['expires_after']) return true;
    return false;
  });

  readonly filterConfigs = computed<FilterConfig[]>(() => [
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
    {
      key: 'has_stock',
      label: 'Solo con stock',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Solo con stock' },
        { value: 'false', label: 'Sin stock' },
      ],
    },
    {
      key: 'expires_after',
      label: 'Caduca desde',
      type: 'date',
    },
    {
      key: 'expires_before',
      label: 'Caduca hasta',
      type: 'date',
    },
  ]);

  readonly columns: TableColumn[] = [
    {
      key: 'batch_number',
      label: 'Lote',
      sortable: true,
      priority: 1,
      transform: (v: any) => v || '—',
    },
    {
      key: 'product_name',
      label: 'Producto',
      sortable: true,
      priority: 1,
      transform: (v: any, item?: OrgBatchRow) =>
        v || (item?.product_id ? `#${item.product_id}` : '—'),
    },
    {
      key: 'variant_name',
      label: 'Variante',
      sortable: false,
      priority: 3,
      transform: (v: any) => v || '—',
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (v: any) => v || '—',
    },
    {
      key: 'location_name',
      label: 'Bodega',
      sortable: true,
      priority: 3,
      transform: (v: any) => v || '—',
    },
    {
      key: 'available_quantity',
      label: 'Disponible',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (v: any) => this.formatQuantity(v),
    },
    {
      key: 'quantity',
      label: 'Total',
      sortable: true,
      align: 'right',
      priority: 3,
      transform: (v: any) => this.formatQuantity(v),
    },
    {
      key: 'manufacturing_date',
      label: 'Fabricación',
      sortable: true,
      priority: 3,
      transform: (v: any) => this.formatDate(v),
    },
    {
      key: 'expiration_date',
      label: 'Caducidad',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: EXPIRY_STATUS_COLOR_MAP,
      },
      badgeTransform: (_v: any, item?: OrgBatchRow) =>
        this.formatExpiryBadge(item),
    },
  ];

  readonly actions: TableAction[] = [];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'batch_number',
    titleTransform: (item: any) => item?.batch_number || '—',
    subtitleKey: 'product_name',
    subtitleTransform: (item: any) =>
      item?.product_name || (item?.product_id ? `#${item.product_id}` : '—'),
    avatarFallbackIcon: 'layers',
    avatarShape: 'square',
    badgeKey: 'expiration_date',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: EXPIRY_STATUS_COLOR_MAP,
    },
    badgeTransform: (_v: any, item?: any) => this.formatExpiryBadge(item),
    footerKey: 'expiration_date',
    footerLabel: 'Caduca',
    footerTransform: (v: any) => this.formatDate(v),
    detailKeys: [
      {
        key: 'available_quantity',
        label: 'Disponible',
        transform: (v: any) => this.formatQuantity(v),
      },
      {
        key: 'store_name',
        label: 'Tienda',
        transform: (v: any) => v || '—',
      },
      {
        key: 'location_name',
        label: 'Bodega',
        icon: 'map-pin',
        transform: (v: any) => v || '—',
      },
    ],
  };

  constructor() {
    this.loadStores();
    // Fetch whenever filters/search/page change.
    effect(() => {
      const _trigger = {
        page: this.currentPage(),
        search: this.searchTerm(),
        filters: this.filterValues(),
      };
      void _trigger;
      this.loadBatches();
    });
  }

  private loadBatches(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const filters = this.filterValues();
    const params = {
      page: this.currentPage(),
      limit: this.pageLimit,
      ...(this.searchTerm().trim()
        ? { batch_number: this.searchTerm().trim() }
        : {}),
      ...(filters['store_id'] ? { store_id: String(filters['store_id']) } : {}),
      ...(filters['has_stock']
        ? { has_stock: String(filters['has_stock']) }
        : {}),
      ...(filters['expires_before']
        ? { expires_before: this.toEndOfDayISO(String(filters['expires_before'])) }
        : {}),
      ...(filters['expires_after']
        ? { expires_after: this.toStartOfDayISO(String(filters['expires_after'])) }
        : {}),
    };

    this.service
      .list(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          const meta = res?.meta;
          const total =
            meta?.total ??
            meta?.pagination?.total ??
            (res?.data?.length ?? 0);
          this.totalRows.set(total);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgBatches] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los lotes.'),
          );
          this.loading.set(false);
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
          console.error('[OrgBatches] stores load failed', err);
        },
      });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term ?? '');
    this.currentPage.set(1);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.currentPage.set(1);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.currentPage.set(1);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ningún lote coincide con los filtros'
      : 'Sin lotes';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar la búsqueda o los filtros.'
      : 'No hay lotes de inventario registrados.';
  }

  private formatExpiryBadge(item?: OrgBatchRow): string {
    if (!item || !item.expiration_date) return EXPIRY_STATUS_LABEL['none'];
    const ms = Date.parse(item.expiration_date);
    if (Number.isNaN(ms)) return EXPIRY_STATUS_LABEL['none'];
    const now = Date.now();
    const horizon = now + EXPIRING_DAYS_AHEAD * 24 * 60 * 60 * 1000;
    if (ms < now) return EXPIRY_STATUS_LABEL['expired'];
    if (ms <= horizon) return EXPIRY_STATUS_LABEL['expiring'];
    return EXPIRY_STATUS_LABEL['ok'];
  }

  /**
   * Date-only display: parse the ISO date as UTC and format using UTC
   * components to avoid local-timezone off-by-one drift on `manufacturing_date`
   * / `expiration_date` (date-only fields stored as UTC midnight).
   */
  private formatDate(value: any): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  private formatQuantity(value: any): string {
    if (value === null || value === undefined || value === '') return '0';
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) return String(value);
    return String(n);
  }

  /** Convert a date-input value (YYYY-MM-DD) to start-of-day UTC ISO. */
  private toStartOfDayISO(value: string): string {
    if (!value) return value;
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }

  /** Convert a date-input value (YYYY-MM-DD) to end-of-day UTC ISO. */
  private toEndOfDayISO(value: string): string {
    if (!value) return value;
    return new Date(`${value}T23:59:59.999Z`).toISOString();
  }
}
