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
    this.loadMovements();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

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
        const data = (response.data ?? []) as InventoryMovement[];
        this.movements.set(data);
        const meta = response.meta as
          | { pagination?: { total?: number; total_pages?: number } }
          | undefined;
        const total =
          meta?.pagination?.total ??
          (Array.isArray(response.data) ? response.data.length : 0);
        this.totalItems.set(total);
        this.calculateStats();
        this.is_loading.set(false);
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar movimientos');
        this.is_loading.set(false);
      },
    });
    this.subscriptions.push(sub);
  }

  calculateStats(): void {
    // Stats reflect the global total of the current query, not just the
    // current page slice. The backend exposes `total` in the pagination meta.
    this.stats.set({
      total: this.totalItems(),
      stock_in: 0, // aggregated server-side would be ideal — placeholder
      stock_out: 0,
      transfers: 0,
    });
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
