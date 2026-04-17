import { Component, OnInit, signal, computed, DestroyRef, inject } from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  imports: [StatsComponent, SupplierFormModalComponent, SupplierListComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Proveedores"
          [value]="stats().total"
          smallText="Proveedores registrados"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Activos"
          [value]="stats().active"
          smallText="Disponibles para compras"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivos"
          [value]="stats().inactive"
          smallText="Suspendidos o deshabilitados"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Órdenes Pendientes"
          [value]="stats().pending_orders"
          smallText="Por recibir"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Supplier List -->
      <app-supplier-list
        [suppliers]="suppliers()"
        [isLoading]="is_loading()"
        [totalItems]="totalItems()"
        [currentPage]="filters().page"
        [totalPages]="totalPages()"
        [limit]="filters().limit"
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
        [isOpen]="is_modal_open()"
        [supplier]="selected_supplier()"
        [isSubmitting]="is_submitting()"
        (cancel)="closeModal()"
        (save)="onSaveSupplier($event)"
      ></app-supplier-form-modal>
    </div>
  `,
})
export class SuppliersComponent implements OnInit {
  suppliers = signal<Supplier[]>([]);
  selected_supplier = signal<Supplier | null>(null);

  filters = signal({ page: 1, limit: 10 });
  totalItems = signal(0);

  stats = signal({
    total: 0,
    active: 0,
    inactive: 0,
    pending_orders: 0,
  });

  status_filter: 'all' | 'active' | 'inactive' = 'all';
  search_term = signal('');

  is_loading = signal(false);
  is_modal_open = signal(false);
  is_submitting = signal(false);

  totalPages = computed(() => {
    return Math.ceil(this.totalItems() / this.filters().limit) || 1;
  });

  private destroyRef = inject(DestroyRef);

  constructor(
    private suppliersService: SuppliersService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    this.loadSuppliers();
  }

  loadSuppliers(): void {
    this.is_loading.set(true);

    const query: any = {
      page: this.filters().page,
      limit: this.filters().limit,
    };

    if (this.search_term()) {
      query.search = this.search_term();
    }

    if (this.status_filter === 'active') {
      query.is_active = true;
    } else if (this.status_filter === 'inactive') {
      query.is_active = false;
    }

    this.suppliersService
      .getSuppliers(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (response.data) {
            this.suppliers.set(response.data);
            this.totalItems.set(
              response.meta?.pagination?.total ?? response.data.length,
            );
            this.calculateStats();
          }
          this.is_loading.set(false);
        },
        error: (error) => {
          this.toastService.error(error || 'Error al cargar proveedores');
          this.is_loading.set(false);
        },
      });
  }

  calculateStats(): void {
    const list = this.suppliers();
    this.stats.update((s) => ({
      ...s,
      total: list.length,
      active: list.filter((sup) => sup.is_active).length,
      inactive: list.filter((sup) => !sup.is_active).length,
    }));
  }

  onSearch(term: string): void {
    this.search_term.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
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

    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSuppliers();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadSuppliers();
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.loadSuppliers();
      return;
    }
    this.suppliers.update((list) =>
      [...list].sort((a, b) => {
        const val_a = (a as any)[event.column] || '';
        const val_b = (b as any)[event.column] || '';
        const comparison = String(val_a).localeCompare(String(val_b));
        return event.direction === 'asc' ? comparison : -comparison;
      }),
    );
  }

  openCreateModal(): void {
    this.selected_supplier.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(supplier: Supplier): void {
    this.selected_supplier.set(supplier);
    this.is_modal_open.set(true);
  }

  closeModal(): void {
    this.is_modal_open.set(false);
    this.selected_supplier.set(null);
  }

  onSaveSupplier(data: CreateSupplierDto | UpdateSupplierDto): void {
    this.is_submitting.set(true);

    const supplier = this.selected_supplier();
    if (supplier) {
      this.suppliersService
        .updateSupplier(supplier.id, data)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Proveedor actualizado correctamente');
            this.is_submitting.set(false);
            this.closeModal();
            this.loadSuppliers();
          },
          error: (error) => {
            this.toastService.error(error || 'Error al actualizar proveedor');
            this.is_submitting.set(false);
          },
        });
    } else {
      this.suppliersService
        .createSupplier(data as CreateSupplierDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Proveedor creado correctamente');
            this.is_submitting.set(false);
            this.closeModal();
            this.loadSuppliers();
          },
          error: (error) => {
            this.toastService.error(error || 'Error al crear proveedor');
            this.is_submitting.set(false);
          },
        });
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
    this.suppliersService
      .deleteSupplier(supplier.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Proveedor eliminado correctamente');
          this.loadSuppliers();
        },
        error: (error) => {
          this.toastService.error(error || 'Error al eliminar proveedor');
        },
      });
  }
}
