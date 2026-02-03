import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

// Shared Components
import {
  ButtonComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  StatsComponent,
  ToastService,
  DialogService,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../shared/components/index';

// Services
import { SuppliersService } from '../services';

// Interfaces
import { Supplier, CreateSupplierDto, UpdateSupplierDto } from '../interfaces';

// Child Components
import { SupplierFormModalComponent } from './components/supplier-form-modal.component';

@Component({
  selector: 'app-suppliers',
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
    SupplierFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8">
        <app-stats
          title="Total Proveedores"
          [value]="stats.total"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Activos"
          [value]="stats.active"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivos"
          [value]="stats.inactive"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Órdenes Pendientes"
          [value]="stats.pending_orders"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Suppliers List Container -->
      <div class="bg-surface rounded-card shadow-card border border-border min-h-[600px]">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Proveedores ({{ stats.total }})
              </h2>
            </div>

            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <app-inputsearch
                class="w-full sm:w-48 flex-shrink-0"
                size="sm"
                placeholder="Buscar proveedor..."
                (search)="onSearch($event)"
              ></app-inputsearch>

              <app-selector
                class="w-full sm:w-36"
                [options]="status_options"
                [(ngModel)]="status_filter"
                placeholder="Estado"
                size="sm"
                (valueChange)="filterByStatus($event)"
              ></app-selector>

              <div class="flex gap-2 items-center ml-auto">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="loadSuppliers()"
                  [disabled]="is_loading"
                  title="Refrescar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateModal()"
                  title="Nuevo Proveedor"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nuevo Proveedor</span>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="is_loading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando proveedores...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!is_loading && filtered_suppliers.length === 0" class="p-12 text-center text-gray-500">
          <app-icon name="users" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay proveedores</h3>
          <p class="mt-1">Comienza agregando un nuevo proveedor.</p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Agregar Proveedor
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_suppliers.length > 0" class="p-6">
          <app-responsive-data-view
            [data]="filtered_suppliers"
            [columns]="table_columns"
            [cardConfig]="cardConfig"
            [actions]="table_actions"
            [loading]="is_loading"
            emptyMessage="No hay proveedores registrados"
            emptyIcon="users"
            (sort)="onSort($event)"
            (rowClick)="onRowClick($event)"
          ></app-responsive-data-view>
        </div>
      </div>

      <!-- Create/Edit Modal -->
      <app-supplier-form-modal
        [isOpen]="is_modal_open"
        [supplier]="selected_supplier"
        [isSubmitting]="is_submitting"
        (cancel)="closeModal()"
        (save)="onSaveSupplier($event)"
      ></app-supplier-form-modal>
    </div>
  `,
})
export class SuppliersComponent implements OnInit, OnDestroy {
  // Data
  suppliers: Supplier[] = [];
  filtered_suppliers: Supplier[] = [];
  selected_supplier: Supplier | null = null;

  // Stats
  stats = {
    total: 0,
    active: 0,
    inactive: 0,
    pending_orders: 0,
  };

  // Filters
  status_filter: 'all' | 'active' | 'inactive' = 'all';
  search_term = '';

  status_options: SelectorOption[] = [
    { value: 'all', label: 'Todos' },
    { value: 'active', label: 'Activos' },
    { value: 'inactive', label: 'Inactivos' },
  ];

  // Table Configuration
  table_columns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, width: '100px', priority: 3 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'contact_person', label: 'Contacto', defaultValue: '-', priority: 2 },
    { key: 'email', label: 'Email', defaultValue: '-', priority: 2 },
    { key: 'phone', label: 'Teléfono', defaultValue: '-', priority: 3 },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: Supplier) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Supplier) => this.confirmDelete(item),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'contact_person',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'code', label: 'Código', icon: 'hash' },
      { key: 'email', label: 'Email', icon: 'mail' },
      { key: 'phone', label: 'Teléfono', icon: 'phone' },
    ],
  };

  // UI State
  is_loading = false;
  is_modal_open = false;
  is_submitting = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private suppliersService: SuppliersService,
    private toastService: ToastService,
    private dialogService: DialogService
  ) { }

  ngOnInit(): void {
    this.loadSuppliers();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // ============================================================
  // Data Loading
  // ============================================================

  loadSuppliers(): void {
    this.is_loading = true;
    const query = this.search_term ? { search: this.search_term } : {};

    const sub = this.suppliersService.getSuppliers(query).subscribe({
      next: (response) => {
        if (response.data) {
          this.suppliers = response.data;
          this.applyFilters();
          this.calculateStats();
        }
        this.is_loading = false;
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar proveedores');
        this.is_loading = false;
      },
    });
    this.subscriptions.push(sub);
  }

  applyFilters(): void {
    let filtered = [...this.suppliers];

    if (this.status_filter === 'active') {
      filtered = filtered.filter((s) => s.is_active);
    } else if (this.status_filter === 'inactive') {
      filtered = filtered.filter((s) => !s.is_active);
    }

    if (this.search_term) {
      const term = this.search_term.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name?.toLowerCase().includes(term) ||
          s.code?.toLowerCase().includes(term) ||
          s.contact_person?.toLowerCase().includes(term)
      );
    }

    this.filtered_suppliers = filtered;
  }

  calculateStats(): void {
    this.stats.total = this.suppliers.length;
    this.stats.active = this.suppliers.filter((s) => s.is_active).length;
    this.stats.inactive = this.suppliers.filter((s) => !s.is_active).length;
    // pending_orders would come from a separate API call in a real scenario
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSearch(term: string): void {
    this.search_term = term;
    this.applyFilters();
  }

  filterByStatus(status: string | number | null): void {
    this.status_filter = (status as 'all' | 'active' | 'inactive') || 'all';
    this.applyFilters();
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.loadSuppliers();
      return;
    }
    // Client-side sorting for simplicity
    this.suppliers = [...this.suppliers].sort((a, b) => {
      const val_a = (a as any)[event.column] || '';
      const val_b = (b as any)[event.column] || '';
      const comparison = String(val_a).localeCompare(String(val_b));
      return event.direction === 'asc' ? comparison : -comparison;
    });
  }

  onRowClick(supplier: Supplier): void {
    this.openEditModal(supplier);
  }

  // ============================================================
  // Modal Management
  // ============================================================

  openCreateModal(): void {
    this.selected_supplier = null;
    this.is_modal_open = true;
  }

  openEditModal(supplier: Supplier): void {
    this.selected_supplier = supplier;
    this.is_modal_open = true;
  }

  closeModal(): void {
    this.is_modal_open = false;
    this.selected_supplier = null;
  }

  // ============================================================
  // CRUD Operations
  // ============================================================

  onSaveSupplier(data: CreateSupplierDto | UpdateSupplierDto): void {
    this.is_submitting = true;

    if (this.selected_supplier) {
      // Update
      const sub = this.suppliersService
        .updateSupplier(this.selected_supplier.id, data)
        .subscribe({
          next: () => {
            this.toastService.success('Proveedor actualizado correctamente');
            this.is_submitting = false;
            this.closeModal();
            this.loadSuppliers();
          },
          error: (error) => {
            this.toastService.error(error || 'Error al actualizar proveedor');
            this.is_submitting = false;
          },
        });
      this.subscriptions.push(sub);
    } else {
      // Create
      const sub = this.suppliersService.createSupplier(data as CreateSupplierDto).subscribe({
        next: () => {
          this.toastService.success('Proveedor creado correctamente');
          this.is_submitting = false;
          this.closeModal();
          this.loadSuppliers();
        },
        error: (error) => {
          this.toastService.error(error || 'Error al crear proveedor');
          this.is_submitting = false;
        },
      });
      this.subscriptions.push(sub);
    }
  }

  confirmDelete(supplier: Supplier): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Proveedor',
        message: `¿Está seguro de que desea eliminar "${supplier.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteSupplier(supplier);
        }
      });
  }

  deleteSupplier(supplier: Supplier): void {
    const sub = this.suppliersService.deleteSupplier(supplier.id).subscribe({
      next: () => {
        this.toastService.success('Proveedor eliminado correctamente');
        this.loadSuppliers();
      },
      error: (error) => {
        this.toastService.error(error || 'Error al eliminar proveedor');
      },
    });
    this.subscriptions.push(sub);
  }
}
