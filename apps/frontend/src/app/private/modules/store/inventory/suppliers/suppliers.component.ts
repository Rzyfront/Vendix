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
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

// Interfaces
import {
  Supplier,
  SupplierAssignableState,
  CreateSupplierDto,
  UpdateSupplierDto,
} from '../interfaces';

// Utils
import { parseApiError } from '../../../../../core/utils/parse-api-error';

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
          smallText="Visibles pero no seleccionables"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        @if (status_filter() === 'archived') {
          <app-stats
            title="Archivados"
            [value]="stats().archived"
            smallText="Eliminados; historial conservado"
            iconName="archive"
            iconBgColor="bg-gray-100"
            iconColor="text-gray-600"
          ></app-stats>
        }

        <app-stats
          title="Órdenes Pendientes"
          [value]="stats().pending_orders"
          smallText="Por recibir"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Read-only banner when org is in ORGANIZATION scope -->
      @if (!canMutate()) {
        <div
          class="bg-blue-50 rounded-xl border border-blue-200 p-4 shadow-sm mb-4 mx-2 md:mx-0"
        >
          <p class="text-sm text-blue-800">
            Los proveedores se gestionan a nivel organización en este modo.
            Esta vista es de solo lectura.
          </p>
        </div>
      }

      <!-- Supplier List -->
      <app-supplier-list
        [suppliers]="suppliers()"
        [isLoading]="is_loading()"
        [totalItems]="totalItems()"
        [currentPage]="filters().page"
        [totalPages]="totalPages()"
        [limit]="filters().limit"
        [canMutate]="canMutate()"
        (refresh)="loadSuppliers()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (delete)="confirmDelete($event)"
        (sort)="onSort($event)"
        (pageChange)="onPageChange($event)"
      ></app-supplier-list>

      <!-- Create/Edit Modal (only mounted when mutations are allowed) -->
      @if (canMutate()) {
        <app-supplier-form-modal
          [isOpen]="is_modal_open()"
          [supplier]="selected_supplier()"
          [isSubmitting]="is_submitting()"
          (cancel)="closeModal()"
          (save)="onSaveSupplier($event)"
        ></app-supplier-form-modal>
      }
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
    archived: 0,
    pending_orders: 0,
  });

  /**
   * `all` excluye archivados (es el default del backend); `archived` los
   * consulta explícitamente. Es signal porque `loadSuppliers` lo lee en cada
   * ciclo y el filtro debe poder recomponerse sin depender del orden de
   * asignación.
   */
  status_filter = signal<'all' | 'active' | 'inactive' | 'archived'>('all');
  search_term = signal('');

  is_loading = signal(false);
  is_modal_open = signal(false);
  is_submitting = signal(false);

  totalPages = computed(() => {
    return Math.ceil(this.totalItems() / this.filters().limit) || 1;
  });

  private destroyRef = inject(DestroyRef);
  private authFacade = inject(AuthFacade);

  /**
   * Suppliers are managed at the organization level when the org operates in
   * ORGANIZATION scope. In that case the store-side UI must be read-only.
   * STORE_ADMIN can still see suppliers but cannot mutate them via UI.
   */
  readonly canMutate = computed(
    () => this.authFacade.operatingScope() === 'STORE',
  );

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

    // `all` no manda `state`: el backend ya excluye archivados por defecto.
    const status = this.status_filter();
    if (status !== 'all') {
      query.state = status;
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
      active: list.filter((sup) => sup.state === 'active').length,
      inactive: list.filter((sup) => sup.state === 'inactive').length,
      archived: list.filter((sup) => sup.state === 'archived').length,
    }));
  }

  onSearch(term: string): void {
    this.search_term.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSuppliers();
  }

  onFilterChange(values: FilterValues): void {
    const stateValue = values['state'] as string;

    this.status_filter.set(
      stateValue === 'active' ||
        stateValue === 'inactive' ||
        stateValue === 'archived'
        ? stateValue
        : 'all',
    );

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
    if (!this.canMutate()) return;
    this.selected_supplier.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(supplier: Supplier): void {
    if (!this.canMutate()) return;
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
    if (!this.canMutate()) return;
    this.dialogService
      .confirm({
        title: 'Eliminar Proveedor',
        message:
          `¿Eliminar "${supplier.name}"? Dejará de aparecer en listados y ` +
          `selectores, pero su historial de compras, facturas y pagos se ` +
          `conserva y podrás consultarlo con el filtro "Archivados".`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.archiveSupplier(supplier);
        }
      });
  }

  /**
   * "Eliminar" archiva. Si el backend responde 409
   * `SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS`, se nombran los documentos abiertos y
   * se ofrece inactivar como alternativa: el proveedor deja de ser
   * seleccionable sin esconder el trabajo que sigue en curso.
   */
  archiveSupplier(supplier: Supplier): void {
    this.suppliersService
      .archiveSupplier(supplier.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Proveedor archivado correctamente');
          this.loadSuppliers();
        },
        error: (error) => {
          const { errorCode, userMessage, details } = parseApiError(error);

          if (errorCode === 'SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS') {
            this.offerDeactivate(supplier, details);
            return;
          }

          this.toastService.error(userMessage);
        },
      });
  }

  /** Enumera los documentos abiertos y propone inactivar en su lugar. */
  private offerDeactivate(supplier: Supplier, details: any): void {
    const reasons: string[] = [];
    if (details?.open_purchase_orders > 0) {
      reasons.push(
        `${details.open_purchase_orders} orden(es) de compra sin recibir`,
      );
    }
    if (details?.unpaid_payables > 0) {
      reasons.push(`${details.unpaid_payables} cuenta(s) por pagar con saldo`);
    }
    if (details?.open_dispatch_notes > 0) {
      reasons.push(`${details.open_dispatch_notes} remisión(es) en curso`);
    }

    this.dialogService
      .confirm({
        title: 'No se puede archivar',
        message:
          `"${supplier.name}" tiene ${reasons.join(', ')}. ` +
          `Archivarlo lo ocultaría mientras ese trabajo sigue abierto. ` +
          `¿Prefieres inactivarlo? Seguirá visible en el listado pero nadie ` +
          `podrá seleccionarlo en documentos nuevos.`,
        confirmText: 'Inactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.changeState(supplier, 'inactive');
        }
      });
  }

  /** Transición activo ↔ inactivo. */
  changeState(supplier: Supplier, state: SupplierAssignableState): void {
    if (!this.canMutate()) return;
    this.suppliersService
      .setSupplierState(supplier.id, state)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            state === 'active'
              ? 'Proveedor activado correctamente'
              : 'Proveedor inactivado correctamente',
          );
          this.loadSuppliers();
        },
        error: (error) => {
          this.toastService.error(parseApiError(error).userMessage);
        },
      });
  }
}
