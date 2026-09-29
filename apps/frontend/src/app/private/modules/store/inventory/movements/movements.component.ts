import {Component, OnInit, OnDestroy, signal, DestroyRef, inject, computed} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Subscription } from 'rxjs';

// Shared Components
import {
  StatsComponent,
  ToastService,
  FilterValues,
  PaginationComponent,
} from '../../../../../shared/components/index';

// Local Components
import { MovementDetailModalComponent } from './components/movement-detail-modal.component';
import { MovementListComponent } from './components/movement-list';

// Services
import { InventoryService } from '../services';
import {
  VexiUiHost,
  VexiUiHostRegistry,
  vexiWhenReady,
} from '../../../../../core/services/vexi-ui-host.registry';

// Interfaces
import { InventoryMovement, MovementType } from '../interfaces';

interface MovementsStats {
  total: number;
  stock_in: number;
  stock_out: number;
  transfers: number;
}

@Component({
  selector: 'app-movements',
  standalone: true,
  imports: [
    StatsComponent,
    PaginationComponent,
    MovementDetailModalComponent,
    MovementListComponent
],
  styles: [`
    @media (max-width: 639px) {
      .stats-container app-stats:first-child {
        margin-left: -1rem;
        padding-left: 0;
      }
    }
  `],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Movimientos"
          [value]="stats().total"
          smallText="Movimientos registrados"
          iconName="activity"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Entradas"
          [value]="stats().stock_in"
          smallText="Ingresos de stock"
          iconName="arrow-down-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Salidas"
          [value]="stats().stock_out"
          smallText="Egresos de stock"
          iconName="arrow-up-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Transferencias"
          [value]="stats().transfers"
          smallText="Entre ubicaciones"
          iconName="repeat"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Movements List -->
      <app-movement-list
        [movements]="movements()"
        [isLoading]="is_loading()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="viewDetail($event)"
      ></app-movement-list>

      <!-- Pagination -->
      <div class="mt-4 flex justify-center">
        <app-pagination
          [currentPage]="filters().page"
          [totalPages]="totalPages()"
          [total]="totalItems()"
          [limit]="filters().limit"
          (pageChange)="onPageChange($event)"
        />
      </div>

      <!-- Detail Modal -->
      <app-movement-detail-modal
        [isOpen]="is_detail_modal_open()"
        [movement]="selected_movement()"
        (isOpenChange)="is_detail_modal_open.set($event)"
        (close)="closeDetailModal()"
      ></app-movement-detail-modal>
    </div>
  `,
})
export class MovementsComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private vexiHosts = inject(VexiUiHostRegistry);
  // Data
  readonly movements = signal<InventoryMovement[]>([]);

  // Stats
  readonly stats = signal<MovementsStats>({
    total: 0,
    stock_in: 0,
    stock_out: 0,
    transfers: 0,
  });

  // Pagination + filters
  readonly filters = signal({ page: 1, limit: 25 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  // Filters
  current_type: MovementType | 'all' = 'all';
  search_term = signal('');

  // UI State
  readonly is_loading = signal(false);
  readonly is_detail_modal_open = signal(false);
  readonly selected_movement = signal<InventoryMovement | null>(null);

  private subscriptions: Subscription[] = [];

  constructor(
    private inventoryService: InventoryService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.vexiHosts.register(this.vexiHostAdapter);
    this.loadMovements();
  }

  ngOnDestroy(): void {
    this.vexiHosts.unregister(this.vexiHostAdapter);
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // ── Host de Vexi (G8) ─────────────────────────────────────────────────
  //
  // Adapter delegating in the list's own handlers (`onSearch`,
  // `onFilterChange`, `onPageChange`), which reset to page 1 exactly like
  // the UI controls do. No mutating actions: movements are history, and
  // adjustments live in their own screen.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'inventory_movements',
    readScreen: () => ({
      module_key: 'inventory_movements',
      title: 'Movimientos de inventario',
      visible_count: this.movements().length,
      filters: {
        search: this.search_term() || undefined,
        movement_type: this.current_type !== 'all' ? this.current_type : undefined,
      },
      page: this.filters().page,
      limit: this.filters().limit,
      total: this.totalItems(),
      total_pages: this.totalPages(),
      open_modal: this.is_detail_modal_open()
        ? { id: 'detalle_movimiento', title: 'el detalle del movimiento' }
        : undefined,
      notes: this.is_loading()
        ? 'La lista todavía está cargando.'
        : `${this.stats().total} movimiento(s) en total (${this.stats().stock_in} entradas, ${this.stats().stock_out} salidas).`,
    }),
    listActions: () => [
      { id: 'limpiar_filtros', label: 'Quitar todos los filtros de la lista' },
    ],
    runAction: async (id) => {
      if (id === 'limpiar_filtros') {
        this.onClearFilters();
        return { status: 'ok' as const, message: 'Quité los filtros de la lista.' };
      }
      return {
        status: 'not_found' as const,
        message: `La pantalla de Movimientos no tiene una acción "${id}".`,
      };
    },
    setFilter: async (values) => {
      const applied: string[] = [];
      const ignored: string[] = [];
      let note: string | undefined;

      if (typeof values['search'] === 'string') {
        this.onSearch(values['search']);
        applied.push(`búsqueda "${values['search']}"`);
      }

      if (values['movement_type'] !== undefined || values['type'] !== undefined) {
        const type = String(values['movement_type'] ?? values['type'] ?? '');
        this.onFilterChange({ movement_type: type } as FilterValues);
        applied.push(`tipo ${type || 'todos'}`);
      }

      if (values['limit'] !== undefined || values['sort'] !== undefined) {
        if (values['limit'] !== undefined) ignored.push('limit');
        if (values['sort'] !== undefined) ignored.push('sort');
      }

      if (values['page'] !== undefined) {
        let page = Math.floor(Number(values['page']));
        if (!Number.isFinite(page)) {
          ignored.push('page');
        } else {
          const totalPages = this.totalPages();
          if (page < 1) page = 1;
          if (page > totalPages) {
            note = `Pediste la página ${page} pero solo hay ${totalPages}; te dejé en la última.`;
            page = totalPages;
          }
          this.onPageChange(page);
          applied.push(`página ${page}`);
        }
      }

      for (const key of Object.keys(values)) {
        if (!['search', 'movement_type', 'type', 'limit', 'sort', 'page'].includes(key)) {
          ignored.push(key);
        }
      }

      if (!applied.length) {
        return {
          status: 'not_found' as const,
          message:
            'La lista de Movimientos filtra por búsqueda y tipo, y pagina con page. No cambia filas por página ni ordena.',
        };
      }

      return {
        status: 'ok' as const,
        message:
          `Apliqué ${applied.join(', ')} en movimientos. La lista se está recargando; si necesitas el conteo, léelo de la pantalla después.` +
          (note ? ` ${note}` : '') +
          (ignored.length
            ? ` No apliqué ${ignored.join(', ')} porque esta lista no lo soporta.`
            : ''),
        detail: note ? { note } : undefined,
      };
    },
    closeModal: async () => {
      if (!this.is_detail_modal_open()) {
        return {
          status: 'not_found' as const,
          message: 'No hay ningún modal abierto en Movimientos.',
        };
      }
      this.closeDetailModal();
      return { status: 'ok' as const, message: 'Cerré el detalle del movimiento.' };
    },
    refresh: () => {
      this.loadMovements();
      return { status: 'ok' as const, message: 'Recargué los movimientos.' };
    },
    whenReady: () => vexiWhenReady(() => this.is_loading()),
  };

  // ============================================================
  // Data Loading
  // ============================================================

  loadMovements(): void {
    this.is_loading.set(true);
    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.current_type !== 'all') {
      query['movement_type'] = this.current_type;
    }
    if (this.search_term()) {
      query['search'] = this.search_term();
    }

    const sub = this.inventoryService.getMovements(query).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        // Backend ResponseService.paginated() shape:
        //   { success, message, data: T[], meta: { total, page, limit, totalPages, ... } }
        const list: InventoryMovement[] = Array.isArray(response.data)
          ? response.data
          : [];
        this.movements.set(list);
        this.totalItems.set(response.meta?.total ?? list.length);
        this.loadStats(query);
        this.is_loading.set(false);
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar movimientos');
        this.is_loading.set(false);
      },
    });
    this.subscriptions.push(sub);
  }

  /**
   * Las tarjetas cuentan sobre TODO el conjunto filtrado, no sobre la página.
   * Antes entradas, salidas y transferencias venían fijas en 0 desde aquí: con
   * cientos de movimientos en la tabla, las tres tarjetas mostraban cero. Eso no
   * es un dato faltante, es un dato falso — y para el que lee la pantalla no hay
   * forma de distinguirlo. El agregado se pide al backend con el MISMO filtro
   * que el listado.
   */
  private loadStats(query: Record<string, unknown>): void {
    // El total paginado ya es autoritativo; se deja puesto para que la tarjeta
    // no parpadee a 0 mientras llega el agregado.
    this.stats.update((s) => ({ ...s, total: this.totalItems() }));

    const sub = this.inventoryService
      .getMovementStats(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data;
          if (!data) return;
          this.stats.set({
            total: data.total ?? this.totalItems(),
            stock_in: data.stock_in ?? 0,
            stock_out: data.stock_out ?? 0,
            transfers: data.transfers ?? 0,
          });
        },
        // Un fallo del agregado no debe tumbar el listado, que ya se pintó. Se
        // avisa en silencio y las tarjetas conservan el total real.
        error: () => {},
      });
    this.subscriptions.push(sub);
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSearch(term: string): void {
    this.search_term.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMovements();
  }

  onFilterChange(values: FilterValues): void {
    const typeValue = values['movement_type'] as string;
    this.current_type = typeValue ? (typeValue as MovementType) : 'all';
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMovements();
  }

  onClearFilters(): void {
    this.current_type = 'all';
    this.search_term.set('');
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMovements();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadMovements();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'refresh':
        this.loadMovements();
        break;
    }
  }

  viewDetail(movement: InventoryMovement): void {
    this.selected_movement.set(movement);
    this.is_detail_modal_open.set(true);
  }

  closeDetailModal(): void {
    this.is_detail_modal_open.set(false);
    this.selected_movement.set(null);
  }
}
