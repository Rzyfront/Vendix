import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SortDirection,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import {
  formatDateOnlyUTC,
  toLocalDateString,
} from '../../../../../shared/utils/date.util';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

import { StoreActivityService } from './services/store-activity.service';
import {
  STORE_ACTIVITY_SORTS,
  StoreActivityQuery,
  StoreActivityRow,
  StoreActivitySortBy,
  StoreActivityStats,
} from './contracts/store-activity.contract';
import { StoreActivityDetailModalComponent } from './components/store-activity-detail-modal.component';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return toLocalDateString(d);
}

/**
 * Super-admin `Cuentas > Actividad`: ranking de tiendas por actividad.
 *
 * Patrón standard-module: 4 `app-stats`, `app-card` con barra sticky de
 * búsqueda + dropdown `Filtros` (estado y rango `YYYY-MM-DD` con presets),
 * `app-responsive-data-view` reordenable y `app-pagination` server-side.
 * El detalle por tienda es un modal sobre el ranking: abrirlo y filtrarlo
 * no pierde la página ni los filtros del ranking.
 */
@Component({
  selector: 'app-store-activity-page',
  standalone: true,
  imports: [
    FormsModule,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    StoreActivityDetailModalComponent,
  ],
  templateUrl: './store-activity-page.component.html',
})
export class StoreActivityPageComponent {
  private readonly activityService = inject(StoreActivityService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<StoreActivityRow[]>([]);
  readonly stats = signal<StoreActivityStats>({
    active_stores: 0,
    activity_pct_vs_meta_80: 0,
    avg_hours_per_day: 0,
    inactive_stores: 0,
    orders_total: 0,
  });

  readonly isLoading = signal(false);
  readonly isLoadingStats = signal(false);

  readonly filters = signal({ page: 1, limit: 10 });
  readonly searchTerm = signal('');
  /** Texto del filtro de organización; el backend solo acepta ID numérico
   * (`organization_id`), así que el query mapea dígitos o lo omite. */
  readonly organizationInput = signal('');
  readonly statusValue = signal('');
  readonly from = signal(defaultFrom());
  readonly to = signal(toLocalDateString());
  readonly rangePreset = signal('custom');
  readonly sortBy = signal<StoreActivitySortBy>('score');
  readonly sortOrder = signal<'asc' | 'desc'>('desc');

  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  readonly selectedStore = signal<StoreActivityRow | null>(null);
  readonly isDetailOpen = signal(false);

  /**
   * Proyección reactiva al contrato plano del dropdown: el filtro
   * `'date-range'` se descompone en `range_start/range_end/range_preset`
   * (mismo patrón que las analíticas de tienda). El rango vive aquí en
   * señales `YYYY-MM-DD` y el dropdown solo lo edita.
   */
  readonly filterValues = computed<FilterValues>(() => ({
    is_active: this.statusValue() || null,
    range_start: this.from() || null,
    range_end: this.to() || null,
    range_preset: this.rangePreset(),
  }));

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'true', label: 'Activas' },
        { value: 'false', label: 'Inactivas' },
      ],
    },
    {
      key: 'range',
      label: 'Rango de fechas',
      type: 'date-range',
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
  ];

  readonly rangeLabel = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from && !to) return 'Últimos 30 días';
    if (from && to) return `${formatDateOnlyUTC(from)} – ${formatDateOnlyUTC(to)}`;
    return from ? `Desde ${formatDateOnlyUTC(from)}` : `Hasta ${formatDateOnlyUTC(to)}`;
  });

  readonly hasFilters = computed(
    () =>
      this.searchTerm().trim() !== '' ||
      this.organizationInput().trim() !== '' ||
      this.statusValue() !== '',
  );

  // Solo las 6 columnas de `STORE_ACTIVITY_SORTS` son reordenables: el
  // backend valida `sort` con `IsIn` y responde 400 ante cualquier otra.
  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Tienda', priority: 1 },
    { key: 'slug', label: 'Slug', priority: 3 },
    {
      key: 'organization_name',
      label: 'Organización',
      priority: 2,
      defaultValue: 'N/A',
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
    },
    {
      key: 'score',
      label: 'Score',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (value: number | string) => this.formatScore(value),
    },
    {
      key: 'orders_count',
      label: 'Pedidos',
      sortable: true,
      align: 'center',
      priority: 2,
    },
    {
      key: 'audit_events',
      label: 'Eventos',
      sortable: true,
      align: 'center',
      priority: 3,
    },
    {
      key: 'active_users',
      label: 'Usuarios',
      sortable: true,
      align: 'center',
      priority: 3,
    },
    {
      key: 'revenue_operating',
      label: 'Ingresos',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (value: number | string) =>
        this.currency.format(Number(value) || 0),
    },
    {
      key: 'last_activity_at',
      label: 'Última actividad',
      sortable: true,
      priority: 2,
      transform: (value: string | null) =>
        value ? formatDateOnlyUTC(value) : 'Sin actividad',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'organization_name',
    avatarFallbackIcon: 'store',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'score',
        label: 'Score',
        icon: 'activity',
        transform: (v: number | string) => this.formatScore(v),
      },
      { key: 'orders_count', label: 'Pedidos', icon: 'shopping-bag' },
      { key: 'audit_events', label: 'Eventos', icon: 'list' },
      { key: 'active_users', label: 'Usuarios', icon: 'users' },
      {
        key: 'last_activity_at',
        label: 'Última actividad',
        icon: 'clock',
        transform: (v: string | null) =>
          v ? formatDateOnlyUTC(v) : 'Sin actividad',
      },
    ],
    footerKey: 'revenue_operating',
    footerLabel: 'Ingresos',
    footerStyle: 'prominent',
    footerTransform: (value: number | string) =>
      this.currency.format(Number(value) || 0),
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      tooltip: 'Abrir el detalle de actividad sin salir del ranking',
      action: (row: StoreActivityRow) => this.openDetail(row),
    },
  ];

  /** Query viva del ranking: cualquier filtro la invalida y el efecto
   * de abajo recarga ranking + stats juntos para que las cards sean
   * coherentes con la tabla. Nombres de parámetro idénticos a
   * `StoreActivityQueryDto` (`sort`, no `sort_by`; `organization_id`
   * numérico, no `organization`). */
  readonly rankingQuery = computed<StoreActivityQuery>(() => {
    const orgRaw = this.organizationInput().trim();
    const orgId = /^\d+$/.test(orgRaw) ? Number(orgRaw) : undefined;
    return {
      page: this.filters().page,
      limit: this.filters().limit,
      search: this.searchTerm().trim() || undefined,
      organization_id: orgId,
      is_active:
        this.statusValue() === '' ? undefined : this.statusValue() === 'true',
      from: this.from() || undefined,
      to: this.to() || undefined,
      sort: this.sortBy(),
      order: this.sortOrder(),
    };
  });

  constructor() {
    effect(
      () => {
        this.loadRanking();
        this.loadStats();
      },
      { allowSignalWrites: true },
    );
  }

  loadRanking(): void {
    const query = this.rankingQuery();
    this.isLoading.set(true);
    this.activityService
      .getRanking(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response.data ?? []);
          this.totalItems.set(response.meta?.total ?? 0);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.isLoading.set(false);
          this.toastService.error(
            parseApiError(error).userMessage || 'Error al cargar la actividad',
          );
        },
      });
  }

  loadStats(): void {
    const query = this.rankingQuery();
    this.isLoadingStats.set(true);
    this.activityService
      .getStats(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.data) this.stats.set(response.data);
          this.isLoadingStats.set(false);
        },
        error: () => {
          this.isLoadingStats.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  onOrganizationSearch(term: string): void {
    const next = term ?? '';
    // El backend solo acepta `organization_id` numérico: se acepta vacío o
    // dígitos y se ignora cualquier otro texto (sin recarga inútil).
    if (next !== '' && !/^\d+$/.test(next.trim())) return;
    this.organizationInput.set(next);
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  onFilterChange(values: FilterValues): void {
    this.statusValue.set((values['is_active'] as string) ?? '');
    // Vacío (limpiar del dropdown) = volver al rango por defecto de 30 días,
    // nunca fechas rotas: las señales siempre llevan `YYYY-MM-DD` válido.
    this.from.set((values['range_start'] as string) || defaultFrom());
    this.to.set((values['range_end'] as string) || toLocalDateString());
    this.rangePreset.set((values['range_preset'] as string) || 'custom');
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  onSort(event: { column: string; direction: SortDirection }): void {
    const allowed = STORE_ACTIVITY_SORTS.includes(event.column);
    if (!event.direction || !allowed) {
      this.sortBy.set('score');
      this.sortOrder.set('desc');
    } else {
      this.sortBy.set(event.column as StoreActivitySortBy);
      this.sortOrder.set(event.direction);
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
  }

  onActionClick(action: string): void {
    if (action === 'refresh') {
      this.loadRanking();
      this.loadStats();
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.organizationInput.set('');
    this.statusValue.set('');
    this.from.set(defaultFrom());
    this.to.set(toLocalDateString());
    this.rangePreset.set('custom');
    this.sortBy.set('score');
    this.sortOrder.set('desc');
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  openDetail(row: StoreActivityRow): void {
    this.selectedStore.set(row);
    this.isDetailOpen.set(true);
  }

  formatScore(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Sin resultados para los filtros'
      : 'Sin actividad registrada';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Ajusta la búsqueda, los filtros o el rango de fechas e inténtalo de nuevo.'
      : 'Ninguna tienda reportó actividad en el rango seleccionado.';
  }
}
