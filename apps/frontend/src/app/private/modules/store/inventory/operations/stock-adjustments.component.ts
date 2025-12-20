import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

// Shared Components
import {
  ButtonComponent,
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  StatsComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components/index';

// Services
import { InventoryService } from '../services';

// Interfaces
import { InventoryAdjustment, AdjustmentType } from '../interfaces';

// Child Components
import { AdjustmentCreateModalComponent } from './components/adjustment-create-modal.component';

@Component({
  selector: 'app-stock-adjustments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    TableComponent,
    InputsearchComponent,
    StatsComponent,
    IconComponent,
    SelectorComponent,
    AdjustmentCreateModalComponent,
  ],
  template: `
    <div class="p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <app-stats
          title="Total Ajustes"
          [value]="stats.total"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pérdidas"
          [value]="stats.losses"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Daños"
          [value]="stats.damages"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Correcciones"
          [value]="stats.corrections"
          iconName="edit-3"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Adjustments List Container -->
      <div class="bg-surface rounded-card shadow-card border border-border min-h-[600px]">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Ajustes de Inventario ({{ stats.total }})
              </h2>
            </div>

            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <app-inputsearch
                class="w-full sm:w-48 flex-shrink-0"
                size="sm"
                placeholder="Buscar ajuste..."
                (search)="onSearch($event)"
              ></app-inputsearch>

              <app-selector
                class="w-full sm:w-40"
                [options]="type_options"
                [(ngModel)]="current_type"
                placeholder="Tipo"
                size="sm"
                (valueChange)="filterByType($event)"
              ></app-selector>

              <div class="flex gap-2 items-center ml-auto">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="loadAdjustments()"
                  [disabled]="is_loading"
                  title="Refrescar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateModal()"
                  title="Nuevo Ajuste"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nuevo Ajuste</span>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="is_loading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando ajustes...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!is_loading && filtered_adjustments.length === 0" class="p-12 text-center text-gray-500">
          <app-icon name="clipboard-list" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay ajustes</h3>
          <p class="mt-1">Registra ajustes de inventario cuando sea necesario.</p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Crear Ajuste
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_adjustments.length > 0" class="p-6">
          <app-table
            [data]="filtered_adjustments"
            [columns]="table_columns"
            [actions]="table_actions"
            [loading]="is_loading"
            [hoverable]="true"
            [striped]="true"
            size="md"
            emptyMessage="No hay ajustes de inventario"
          ></app-table>
        </div>
      </div>

      <!-- Create Modal -->
      <app-adjustment-create-modal
        [isOpen]="is_modal_open"
        [isSubmitting]="is_submitting"
        (cancel)="closeModal()"
        (save)="onCreateAdjustment($event)"
      ></app-adjustment-create-modal>
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

  type_options: SelectorOption[] = [
    { value: 'all', label: 'Todos los tipos' },
    { value: 'damage', label: 'Daño' },
    { value: 'loss', label: 'Pérdida' },
    { value: 'theft', label: 'Robo' },
    { value: 'expiration', label: 'Vencido' },
    { value: 'count_variance', label: 'Conteo' },
    { value: 'manual_correction', label: 'Corrección' },
  ];

  // Table Configuration
  table_columns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (value: string) => new Date(value).toLocaleDateString('es-CO'),
    },
    {
      key: 'product.name',
      label: 'Producto',
      sortable: true,
      defaultValue: '-',
      priority: 1,
    },
    {
      key: 'location.name',
      label: 'Ubicación',
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'adjustment_type',
      label: 'Tipo',
      priority: 2,
      transform: (value: AdjustmentType) => this.getTypeLabel(value),
    },
    {
      key: 'quantity_change',
      label: 'Cambio',
      align: 'right',
      priority: 1,
      transform: (value: number) => (value > 0 ? `+${value}` : `${value}`),
    },
    {
      key: 'quantity_before',
      label: 'Antes',
      align: 'right',
      priority: 3,
    },
    {
      key: 'quantity_after',
      label: 'Después',
      align: 'right',
      priority: 3,
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'ghost',
      action: (item: InventoryAdjustment) => this.viewDetail(item),
    },
  ];

  // UI State
  is_loading = false;
  is_modal_open = false;
  is_submitting = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private inventoryService: InventoryService,
    private toastService: ToastService
  ) { }

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
    const query = this.current_type !== 'all' ? { type: this.current_type } : {};

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
      filtered = filtered.filter((a) => a.adjustment_type === this.current_type);
    }

    if (this.search_term) {
      const term = this.search_term.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.product?.name?.toLowerCase().includes(term) ||
          a.description?.toLowerCase().includes(term)
      );
    }

    this.filtered_adjustments = filtered;
  }

  calculateStats(): void {
    this.stats.total = this.adjustments.length;
    this.stats.losses = this.adjustments.filter((a) => a.adjustment_type === 'loss').length;
    this.stats.damages = this.adjustments.filter((a) => a.adjustment_type === 'damage').length;
    this.stats.corrections = this.adjustments.filter(
      (a) => a.adjustment_type === 'manual_correction'
    ).length;
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSearch(term: string): void {
    this.search_term = term;
    this.applyFilters();
  }

  filterByType(type: string | number | null): void {
    this.current_type = (type as AdjustmentType | 'all') || 'all';
    this.applyFilters();
  }

  openCreateModal(): void {
    this.is_modal_open = true;
  }

  closeModal(): void {
    this.is_modal_open = false;
  }

  viewDetail(adjustment: InventoryAdjustment): void {
    // Could open a detail modal
    console.log('View detail:', adjustment);
  }

  // ============================================================
  // CRUD Operations
  // ============================================================

  onCreateAdjustment(data: any): void {
    this.is_submitting = true;

    const sub = this.inventoryService.createAdjustment(data).subscribe({
      next: () => {
        this.toastService.success('Ajuste creado correctamente');
        this.is_submitting = false;
        this.closeModal();
        this.loadAdjustments();
      },
      error: (error) => {
        this.toastService.error(error || 'Error al crear ajuste');
        this.is_submitting = false;
      },
    });
    this.subscriptions.push(sub);
  }

  // ============================================================
  // Helpers
  // ============================================================

  getTypeLabel(type: AdjustmentType): string {
    const labels: Record<AdjustmentType, string> = {
      damage: 'Daño',
      loss: 'Pérdida',
      theft: 'Robo',
      expiration: 'Vencido',
      count_variance: 'Conteo',
      manual_correction: 'Corrección',
    };
    return labels[type] || type;
  }

  getFilterClasses(type: AdjustmentType | 'all'): string {
    const base = 'flex items-center px-3 py-1.5 text-sm font-medium rounded-full transition-colors';
    if (type === this.current_type) {
      return `${base} bg-primary text-white`;
    }
    return `${base} bg-muted/20 text-text-secondary hover:bg-muted/40`;
  }
}
