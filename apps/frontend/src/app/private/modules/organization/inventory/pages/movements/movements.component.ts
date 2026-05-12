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
  OrgInventoryService,
  OrgMovementRow,
} from '../../services/org-inventory.service';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

interface MovementStats {
  total: number;
  inbound: number;
  outbound: number;
  losses: number;
}

interface StoreOption {
  value: number;
  label: string;
}

const INBOUND_TYPES = new Set([
  'stock_in',
  'return',
  'returned',
  'purchase',
  'transfer_in',
  'transfer-in',
]);
const OUTBOUND_TYPES = new Set([
  'stock_out',
  'sale',
  'transfer_out',
  'transfer-out',
]);
const LOSS_TYPES = new Set(['damage', 'expiration', 'theft']);

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  stock_in: 'Entrada',
  stock_out: 'Salida',
  return: 'Devolución',
  returned: 'Devolución',
  purchase: 'Compra',
  sale: 'Venta',
  transfer: 'Transferencia',
  transfer_in: 'Transferencia entrada',
  'transfer-in': 'Transferencia entrada',
  transfer_out: 'Transferencia salida',
  'transfer-out': 'Transferencia salida',
  adjustment: 'Ajuste',
  damage: 'Daño',
  expiration: 'Vencimiento',
  theft: 'Pérdida',
};

const MOVEMENT_TYPE_COLOR_MAP: Record<string, string> = {
  stock_in: '#22c55e',
  return: '#10b981',
  returned: '#10b981',
  purchase: '#06b6d4',
  transfer_in: '#0ea5e9',
  'transfer-in': '#0ea5e9',
  stock_out: '#3b82f6',
  sale: '#6366f1',
  transfer_out: '#8b5cf6',
  'transfer-out': '#8b5cf6',
  transfer: '#a855f7',
  adjustment: '#f59e0b',
  damage: '#ef4444',
  expiration: '#f97316',
  theft: '#dc2626',
};

const PAGE_LIMIT_DEFAULT = 25;

/**
 * ORG_ADMIN — Bitácora consolidada de movimientos de inventario.
 *
 * Read-only audit log con stats, búsqueda por producto, filtros (tipo,
 * tienda, rango de fechas) y vista responsive. El backend `getMovements`
 * NO soporta paginación server-side; se pagina en cliente con `PAGE_LIMIT_DEFAULT`.
 *
 * TODO: cuando el backend acepte `page`/`limit`, migrar a paginación server-side.
 */
@Component({
  selector: 'vendix-org-movements',
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
      <!-- Stats: sticky en mobile, grid en desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Movimientos registrados"
          iconName="arrow-up-down"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        />
        <app-stats
          title="Entradas"
          [value]="stats().inbound"
          smallText="Stock que ingresa"
          iconName="trending-up"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        />
        <app-stats
          title="Salidas"
          [value]="stats().outbound"
          smallText="Stock que sale"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
        />
        <app-stats
          title="Pérdidas"
          [value]="stats().losses"
          smallText="Daño, vencimiento o robo"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner
          variant="danger"
          title="No se pudieron cargar los movimientos"
        >
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <!-- Search/Filters: sticky bajo stats en mobile -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Movimientos ({{ filteredRows().length }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por producto..."
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
            <p class="mt-2 text-text-secondary">Cargando movimientos...</p>
          </div>
        } @else if (filteredRows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="arrow-up-down"
            [title]="getEmptyStateTitle()"
            [description]="getEmptyStateDescription()"
            [showActionButton]="false"
            [showClearFilters]="hasFilters()"
            (clearFiltersClick)="clearFilters()"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="pagedRows()"
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
                  [total]="filteredRows().length"
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
export class OrgMovementsComponent {
  private readonly service = inject(OrgInventoryService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── State ─────────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly rows = signal<OrgMovementRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly currentPage = signal(1);
  readonly storeOptions = signal<StoreOption[]>([]);

  readonly pageLimit = PAGE_LIMIT_DEFAULT;

  // ─── Derived state ──────────────────────────────────────────────────────
  readonly stats = computed<MovementStats>(() => {
    const all = this.rows();
    let inbound = 0;
    let outbound = 0;
    let losses = 0;
    for (const r of all) {
      const t = (r.movement_type || '').toLowerCase();
      if (INBOUND_TYPES.has(t)) inbound++;
      else if (OUTBOUND_TYPES.has(t)) outbound++;
      else if (LOSS_TYPES.has(t)) losses++;
    }
    return {
      total: all.length,
      inbound,
      outbound,
      losses,
    };
  });

  readonly filteredRows = computed<OrgMovementRow[]>(() => {
    const all = this.rows();
    const term = this.searchTerm().trim().toLowerCase();
    const values = this.filterValues();
    const types = (values['movement_type'] as string[] | null) ?? [];
    const storeIdRaw = values['store_id'] as string | null;
    const startDate = values['date_from'] as string | null;
    const endDate = values['date_to'] as string | null;

    const storeId = storeIdRaw ? Number(storeIdRaw) : null;
    const startMs = startDate ? Date.parse(`${startDate}T00:00:00`) : null;
    const endMs = endDate ? Date.parse(`${endDate}T23:59:59.999`) : null;

    return all.filter((r) => {
      // Search by product name
      if (term) {
        const productName = (r.product_name || '').toLowerCase();
        if (!productName.includes(term)) return false;
      }

      // Movement type (multi-select)
      if (types.length > 0) {
        const t = (r.movement_type || '').toLowerCase();
        if (!types.includes(t)) return false;
      }

      // Store
      if (storeId !== null && !Number.isNaN(storeId)) {
        if (r.store_id !== storeId) return false;
      }

      // Date range (inclusive)
      if (startMs !== null || endMs !== null) {
        const created = r.created_at ? Date.parse(r.created_at) : NaN;
        if (Number.isNaN(created)) return false;
        if (startMs !== null && created < startMs) return false;
        if (endMs !== null && created > endMs) return false;
      }

      return true;
    });
  });

  readonly totalPages = computed(() => {
    const total = this.filteredRows().length;
    if (total === 0) return 0;
    return Math.max(1, Math.ceil(total / this.pageLimit));
  });

  readonly pagedRows = computed<OrgMovementRow[]>(() => {
    const list = this.filteredRows();
    const page = this.currentPage();
    const start = (page - 1) * this.pageLimit;
    return list.slice(start, start + this.pageLimit);
  });

  readonly hasFilters = computed(() => {
    if (this.searchTerm().trim().length > 0) return true;
    const v = this.filterValues();
    const types = (v['movement_type'] as string[] | null) ?? [];
    if (types.length > 0) return true;
    if (v['store_id']) return true;
    if (v['date_from']) return true;
    if (v['date_to']) return true;
    return false;
  });

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'movement_type',
      label: 'Tipo de movimiento',
      type: 'multi-select',
      placeholder: 'Todos los tipos',
      options: [
        { value: 'stock_in', label: 'Entrada' },
        { value: 'stock_out', label: 'Salida' },
        { value: 'sale', label: 'Venta' },
        { value: 'purchase', label: 'Compra' },
        { value: 'return', label: 'Devolución' },
        { value: 'transfer', label: 'Transferencia' },
        { value: 'transfer_in', label: 'Transferencia entrada' },
        { value: 'transfer_out', label: 'Transferencia salida' },
        { value: 'adjustment', label: 'Ajuste' },
        { value: 'damage', label: 'Daño' },
        { value: 'expiration', label: 'Vencimiento' },
        { value: 'theft', label: 'Pérdida' },
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
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
    },
  ]);

  // ─── Table / list configuration ────────────────────────────────────────
  readonly columns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      transform: (value: any) => this.formatDateTime(value),
    },
    {
      key: 'movement_type',
      label: 'Tipo',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: MOVEMENT_TYPE_COLOR_MAP,
      },
      badgeTransform: (value: any) => this.formatMovementType(value),
    },
    {
      key: 'product_name',
      label: 'Producto',
      sortable: true,
      priority: 1,
      transform: (value: any, item?: OrgMovementRow) =>
        value || (item?.product_id ? `#${item.product_id}` : '—'),
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
      key: 'quantity',
      label: 'Cantidad',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (value: any) => this.formatQuantity(value),
    },
    {
      key: 'reference',
      label: 'Referencia',
      sortable: false,
      priority: 3,
      transform: (value: any) => value || '—',
    },
  ];

  readonly actions: TableAction[] = [];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    titleTransform: (item: any) =>
      item?.product_name || (item?.product_id ? `#${item.product_id}` : '—'),
    subtitleKey: 'movement_type',
    subtitleTransform: (item: any) => this.formatMovementType(item?.movement_type),
    avatarFallbackIcon: 'arrow-up-down',
    avatarShape: 'square',
    badgeKey: 'movement_type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: MOVEMENT_TYPE_COLOR_MAP,
    },
    badgeTransform: (value: any) => this.formatMovementType(value),
    footerKey: 'created_at',
    footerLabel: 'Fecha',
    footerTransform: (value: any) => this.formatDateTime(value),
    detailKeys: [
      {
        key: 'quantity',
        label: 'Cantidad',
        transform: (value: any) => this.formatQuantity(value),
      },
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
    ],
  };

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  constructor() {
    this.loadMovements();
    this.loadStores();
  }

  private loadMovements(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .getMovements()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgMovements] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los movimientos.'),
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
          console.error('[OrgMovements] stores load failed', err);
        },
      });
  }

  // ─── Event handlers ─────────────────────────────────────────────────────
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

  // ─── Helpers ────────────────────────────────────────────────────────────
  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ningún movimiento coincide con los filtros'
      : 'Sin movimientos';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar los términos de búsqueda o los filtros.'
      : 'No hay movimientos de inventario registrados.';
  }

  private formatMovementType(value: any): string {
    if (!value) return '—';
    const key = String(value).toLowerCase();
    return MOVEMENT_TYPE_LABELS[key] ?? String(value);
  }

  /**
   * Formats `created_at` (ISO timestamp) for display.
   *
   * Uses local timezone because movements are timestamps with hour/minute
   * (not date-only fields). Manual `es-CO` formatting keeps consistent
   * day/month/year + 2-digit hour/minute output without relying on the
   * Angular DatePipe.
   */
  private formatDateTime(value: any): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatQuantity(value: any): string {
    if (value === null || value === undefined || value === '') return '0';
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) return String(value);
    return String(n);
  }
}
