import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

// Shared Components
import {
  StatsComponent,
  ToastService,
  FilterValues,
} from '../../../../../shared/components/index';

// Local Components
import { MovementDetailModalComponent } from './components/movement-detail-modal.component';
import { MovementListComponent } from './components/movement-list';

// Services
import { InventoryService } from '../services';

// Interfaces
import { InventoryMovement, MovementType } from '../interfaces';

@Component({
  selector: 'app-movements',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    MovementDetailModalComponent,
    MovementListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Movimientos"
          [value]="stats.total"
          smallText="Movimientos registrados"
          iconName="activity"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Entradas"
          [value]="stats.stock_in"
          smallText="Ingresos de stock"
          iconName="arrow-down-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Salidas"
          [value]="stats.stock_out"
          smallText="Egresos de stock"
          iconName="arrow-up-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Transferencias"
          [value]="stats.transfers"
          smallText="Entre ubicaciones"
          iconName="repeat"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Movements List -->
      <app-movement-list
        [movements]="filtered_movements"
        [isLoading]="is_loading"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="viewDetail($event)"
      ></app-movement-list>

      <!-- Detail Modal -->
      <app-movement-detail-modal
        [isOpen]="is_detail_modal_open"
        [movement]="selected_movement"
        (isOpenChange)="is_detail_modal_open = $event"
        (close)="closeDetailModal()"
      ></app-movement-detail-modal>
    </div>
  `,
})
export class MovementsComponent implements OnInit, OnDestroy {
  // Data
  movements: InventoryMovement[] = [];
  filtered_movements: InventoryMovement[] = [];

  // Stats
  stats = {
    total: 0,
    stock_in: 0,
    stock_out: 0,
    transfers: 0,
  };

  // Filters
  current_type: MovementType | 'all' = 'all';
  search_term = '';

  // UI State
  is_loading = false;
  is_detail_modal_open = false;
  selected_movement: InventoryMovement | null = null;

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
    this.is_loading = true;
    const query =
      this.current_type !== 'all'
        ? { movement_type: this.current_type }
        : {};

    const sub = this.inventoryService.getMovements(query).subscribe({
      next: (response) => {
        if (response.data) {
          this.movements = Array.isArray(response.data)
            ? response.data
            : [];
          this.applyFilters();
          this.calculateStats();
        }
        this.is_loading = false;
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar movimientos');
        this.is_loading = false;
      },
    });
    this.subscriptions.push(sub);
  }

  applyFilters(): void {
    let filtered = [...this.movements];

    if (this.current_type !== 'all') {
      filtered = filtered.filter(
        (m) => m.movement_type === this.current_type,
      );
    }

    if (this.search_term) {
      const term = this.search_term.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.products?.name?.toLowerCase().includes(term) ||
          m.reason?.toLowerCase().includes(term) ||
          m.notes?.toLowerCase().includes(term) ||
          m.from_location?.name?.toLowerCase().includes(term) ||
          m.to_location?.name?.toLowerCase().includes(term),
      );
    }

    this.filtered_movements = filtered;
  }

  calculateStats(): void {
    this.stats.total = this.movements.length;
    this.stats.stock_in = this.movements.filter(
      (m) => m.movement_type === 'stock_in',
    ).length;
    this.stats.stock_out = this.movements.filter(
      (m) => m.movement_type === 'stock_out',
    ).length;
    this.stats.transfers = this.movements.filter(
      (m) => m.movement_type === 'transfer',
    ).length;
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSearch(term: string): void {
    this.search_term = term;
    this.applyFilters();
  }

  onFilterChange(values: FilterValues): void {
    const typeValue = values['movement_type'] as string;
    this.current_type = typeValue ? (typeValue as MovementType) : 'all';
    this.applyFilters();
  }

  onClearFilters(): void {
    this.current_type = 'all';
    this.search_term = '';
    this.applyFilters();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'refresh':
        this.loadMovements();
        break;
    }
  }

  viewDetail(movement: InventoryMovement): void {
    this.selected_movement = movement;
    this.is_detail_modal_open = true;
  }

  closeDetailModal(): void {
    this.is_detail_modal_open = false;
    this.selected_movement = null;
  }
}
