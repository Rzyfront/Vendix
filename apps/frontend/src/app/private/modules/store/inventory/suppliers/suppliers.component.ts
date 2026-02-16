import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

// Shared Components
import {
  ToastService,
  DialogService,
  StatsComponent,
  FilterValues,
} from '../../../../../shared/components/index';

// Services
import { SuppliersService } from '../services';

// Interfaces
import { Supplier, CreateSupplierDto, UpdateSupplierDto } from '../interfaces';

// Child Components
import { SupplierFormModalComponent } from './components/supplier-form-modal.component';
import { SupplierListComponent } from './components/supplier-list/supplier-list.component';

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    SupplierFormModalComponent,
    SupplierListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Proveedores"
          [value]="stats.total"
          smallText="Proveedores registrados"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Activos"
          [value]="stats.active"
          smallText="Disponibles para compras"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivos"
          [value]="stats.inactive"
          smallText="Suspendidos o deshabilitados"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Órdenes Pendientes"
          [value]="stats.pending_orders"
          smallText="Por recibir"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Supplier List -->
      <app-supplier-list
        [suppliers]="filtered_suppliers"
        [isLoading]="is_loading"
        (refresh)="loadSuppliers()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (delete)="confirmDelete($event)"
        (sort)="onSort($event)"
      ></app-supplier-list>

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

  // UI State
  is_loading = false;
  is_modal_open = false;
  is_submitting = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private suppliersService: SuppliersService,
    private toastService: ToastService,
    private dialogService: DialogService
  ) {}

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

  onFilterChange(values: FilterValues): void {
    const isActiveValue = values['is_active'] as string;

    if (isActiveValue === 'true') {
      this.status_filter = 'active';
    } else if (isActiveValue === 'false') {
      this.status_filter = 'inactive';
    } else {
      this.status_filter = 'all';
    }

    this.applyFilters();
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.loadSuppliers();
      return;
    }
    // Client-side sorting for simplicity
    this.filtered_suppliers = [...this.filtered_suppliers].sort((a, b) => {
      const val_a = (a as any)[event.column] || '';
      const val_b = (b as any)[event.column] || '';
      const comparison = String(val_a).localeCompare(String(val_b));
      return event.direction === 'asc' ? comparison : -comparison;
    });
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
