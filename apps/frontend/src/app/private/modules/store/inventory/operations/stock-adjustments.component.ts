import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

// Shared Components
import {
  ButtonComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  StatsComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../shared/components/index';
import { ConfirmationModalComponent } from '../../../../../shared/components/confirmation-modal/confirmation-modal.component';

// Local Components
import { AdjustmentDetailModalComponent } from './components/adjustment-detail-modal.component';

// Services
import { InventoryService } from '../services';

// Interfaces
import { InventoryAdjustment, AdjustmentType } from '../interfaces';

@Component({
  selector: 'app-stock-adjustments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    StatsComponent,
    IconComponent,
    SelectorComponent,
    ConfirmationModalComponent,
    AdjustmentDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div
        class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8"
      >
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
      <div
        class="bg-surface rounded-card shadow-card border border-border min-h-[600px]"
      >
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Ajustes de Inventario ({{ stats.total }})
              </h2>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
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
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando ajustes...</p>
        </div>

        <!-- Empty State -->
        <div
          *ngIf="!is_loading && filtered_adjustments.length === 0"
          class="p-12 text-center text-gray-500"
        >
          <app-icon
            name="clipboard-list"
            [size]="48"
            class="mx-auto mb-4 text-gray-300"
          ></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay ajustes</h3>
          <p class="mt-1">
            Registra ajustes de inventario cuando sea necesario.
          </p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Crear Ajuste
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_adjustments.length > 0" class="p-6">
          <app-responsive-data-view
            [data]="filtered_adjustments"
            [columns]="table_columns"
            [cardConfig]="cardConfig"
            [actions]="table_actions"
            [loading]="is_loading"
            emptyMessage="No hay ajustes de inventario"
            emptyIcon="clipboard-list"
          ></app-responsive-data-view>
        </div>
      </div>

      <!-- Instruction Modal -->
      <app-confirmation-modal
        *ngIf="is_info_modal_open"
        title="Crear Nuevo Ajuste"
        message="Para realizar un ajuste de inventario, por favor busca el producto en la lista de Productos y selecciona la opción 'Realizar Ajuste' en el detalle del producto."
        confirmText="Ir a Productos"
        cancelText="Entendido"
        confirmVariant="primary"
        [isOpen]="true"
        (confirm)="navigateToProducts()"
        (cancel)="closeInfoModal()"
      ></app-confirmation-modal>

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
      key: 'products.name',
      label: 'Producto',
      sortable: true,
      defaultValue: '-',
      priority: 1,
    },
    {
      key: 'inventory_locations.name',
      label: 'Ubicacion',
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
      label: 'Despues',
      align: 'right',
      priority: 3,
    },
    {
      key: 'created_by_user.user_name',
      label: 'Creado por',
      defaultValue: '-',
      priority: 4,
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

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'products.name',
    titleTransform: (val: any) => val || 'Sin producto',
    subtitleKey: 'adjustment_type',
    subtitleTransform: (val: AdjustmentType) => this.getTypeLabel(val),
    detailKeys: [
      {
        key: 'quantity_change',
        label: 'Cambio',
        transform: (val: number) => (val > 0 ? `+${val}` : `${val}`),
      },
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) => new Date(val).toLocaleDateString('es-CO'),
      },
      {
        key: 'inventory_locations.name',
        label: 'Ubicación',
        icon: 'map-pin',
      },
    ],
  };

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

  filterByType(type: string | number | null): void {
    this.current_type = (type as AdjustmentType | 'all') || 'all';
    this.applyFilters();
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

  // ============================================================
  // CRUD Operations
  // ============================================================

  // Methods removed as creation is now handled in Product Create Page

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
    const base =
      'flex items-center px-3 py-1.5 text-sm font-medium rounded-full transition-colors';
    if (type === this.current_type) {
      return `${base} bg-primary text-white`;
    }
    return `${base} bg-muted/20 text-text-secondary hover:bg-muted/40`;
  }
}
