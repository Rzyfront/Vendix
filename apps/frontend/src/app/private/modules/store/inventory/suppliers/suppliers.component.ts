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
        [suppliers]="suppliers"
        [isLoading]="is_loading"
        [totalItems]="totalItems"
        [currentPage]="filters.page"
        [totalPages]="totalPages"
        [limit]="filters.limit"
        (refresh)="loadSuppliers()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (delete)="confirmDelete($event)"
        (sort)="onSort($event)"
        (pageChange)="onPageChange($event)"
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
  selected_supplier: Supplier | null = null;

  // Pagination
  filters = { page: 1, limit: 10 };
  totalItems = 0;

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

  get totalPages(): number {
    return Math.ceil(this.totalItems / this.filters.limit) || 1;
  }

  loadSuppliers(): void {
    this.is_loading = true;

    const query: any = {
      page: this.filters.page,
      limit: this.filters.limit,
    };

    if (this.search_term) {
      query.search = this.search_term;
    }

    if (this.status_filter === 'active') {
      query.is_active = true;
    } else if (this.status_filter === 'inactive') {
      query.is_active = false;
    }

    const sub = this.suppliersService.getSuppliers(query).subscribe({
      next: (response: any) => {
        if (response.data) {
          this.suppliers = response.data;
          this.totalItems = response.meta?.pagination?.total ?? response.data.length;
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
    this.filters.page = 1;
    this.loadSuppliers();
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

    this.filters.page = 1;
    this.loadSuppliers();
  }

  onPageChange(page: number): void {
    this.filters.page = page;
    this.loadSuppliers();
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
