import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

// Shared Components
import {
  StatsComponent,
  ToastService,
  FilterValues,
} from '../../../../../shared/components/index';
import { ConfirmationModalComponent } from '../../../../../shared/components/confirmation-modal/confirmation-modal.component';

// Local Components
import { AdjustmentDetailModalComponent } from './components/adjustment-detail-modal.component';
import { AdjustmentListComponent } from './components/adjustment-list';

// Services
import { InventoryService } from '../services';

// Interfaces
import { InventoryAdjustment, AdjustmentType } from '../interfaces';

@Component({
  selector: 'app-stock-adjustments',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    ConfirmationModalComponent,
    AdjustmentDetailModalComponent,
    AdjustmentListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Ajustes"
          [value]="stats.total"
          smallText="Movimientos registrados"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pérdidas"
          [value]="stats.losses"
          smallText="Productos extraviados"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Daños"
          [value]="stats.damages"
          smallText="Productos dañados"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Correcciones"
          [value]="stats.corrections"
          smallText="Ajustes de inventario"
          iconName="edit-3"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Adjustments List -->
      <app-adjustment-list
        [adjustments]="filtered_adjustments"
        [isLoading]="is_loading"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="viewDetail($event)"
      ></app-adjustment-list>

      <!-- Instruction Modal -->
      @if (is_info_modal_open) {
        <app-confirmation-modal
          title="Crear Nuevo Ajuste"
          message="Para realizar un ajuste de inventario, por favor busca el producto en la lista de Productos y selecciona la opción 'Realizar Ajuste' en el detalle del producto."
          confirmText="Ir a Productos"
          cancelText="Entendido"
          confirmVariant="primary"
          [isOpen]="true"
          (confirm)="navigateToProducts()"
          (cancel)="closeInfoModal()"
        ></app-confirmation-modal>
      }

      <!-- Detail Modal -->
      <app-adjustment-detail-modal
        [isOpen]="is_detail_modal_open"
        [adjustment]="selected_adjustment"
        (isOpenChange)="is_detail_modal_open = $event"
        (close)="closeDetailModal()"
      ></app-adjustment-detail-modal>
    </div>
  `,
})
export class StockAdjustmentsComponent implements OnInit, OnDestroy {
  // Data
  adjustments: InventoryAdjustment[] = [];
  filtered_adjustments: InventoryAdjustment[] = [];

  // Stats
  stats = {
    total: 0,
    losses: 0,
    damages: 0,
    corrections: 0,
  };

  // Filters
  current_type: AdjustmentType | 'all' = 'all';
  search_term = '';

  // UI State
  is_loading = false;
  is_info_modal_open = false;
  is_detail_modal_open = false;
  selected_adjustment: InventoryAdjustment | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private inventoryService: InventoryService,
    private toastService: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadAdjustments();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // ============================================================
  // Data Loading
  // ============================================================

  loadAdjustments(): void {
    this.is_loading = true;
    const query =
      this.current_type !== 'all' ? { type: this.current_type } : {};

    const sub = this.inventoryService.getAdjustments(query).subscribe({
      next: (response) => {
        if (response.data?.adjustments) {
          this.adjustments = response.data.adjustments;
          this.applyFilters();
          this.calculateStats();
        }
        this.is_loading = false;
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar ajustes');
        this.is_loading = false;
      },
    });
    this.subscriptions.push(sub);
  }

  applyFilters(): void {
    let filtered = [...this.adjustments];

    if (this.current_type !== 'all') {
      filtered = filtered.filter(
        (a) => a.adjustment_type === this.current_type,
      );
    }

    if (this.search_term) {
      const term = this.search_term.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.products?.name?.toLowerCase().includes(term) ||
          a.product?.name?.toLowerCase().includes(term) ||
          a.description?.toLowerCase().includes(term),
      );
    }

    this.filtered_adjustments = filtered;
  }

  calculateStats(): void {
    this.stats.total = this.adjustments.length;
    this.stats.losses = this.adjustments.filter(
      (a) => a.adjustment_type === 'loss',
    ).length;
    this.stats.damages = this.adjustments.filter(
      (a) => a.adjustment_type === 'damage',
    ).length;
    this.stats.corrections = this.adjustments.filter(
      (a) => a.adjustment_type === 'manual_correction',
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
    const typeValue = values['adjustment_type'] as string;
    this.current_type = typeValue ? (typeValue as AdjustmentType) : 'all';
    this.applyFilters();
  }

  onClearFilters(): void {
    this.current_type = 'all';
    this.search_term = '';
    this.applyFilters();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.openCreateModal();
        break;
      case 'refresh':
        this.loadAdjustments();
        break;
    }
  }

  openCreateModal(): void {
    this.is_info_modal_open = true;
  }

  closeInfoModal(): void {
    this.is_info_modal_open = false;
  }

  navigateToProducts(): void {
    this.is_info_modal_open = false;
    this.router.navigate(['/admin/products']);
  }

  viewDetail(adjustment: InventoryAdjustment): void {
    this.selected_adjustment = adjustment;
    this.is_detail_modal_open = true;
  }

  closeDetailModal(): void {
    this.is_detail_modal_open = false;
    this.selected_adjustment = null;
  }
}
