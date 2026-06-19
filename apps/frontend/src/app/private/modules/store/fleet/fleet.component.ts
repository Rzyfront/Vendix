import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastService, DialogService } from '../../../../shared/components/index';
import { FleetService } from './services/fleet.service';
import { VehicleListComponent } from './components/vehicle-list/vehicle-list.component';
import {
  VehicleStatsComponent,
  VehicleStats,
} from './components/vehicle-stats/vehicle-stats.component';
import { VehicleFormModalComponent } from './components/vehicle-form-modal/vehicle-form-modal.component';
import {
  Vehicle,
  CreateVehicleDto,
  VehicleListQuery,
} from './interfaces/vehicle.interface';

@Component({
  selector: 'app-fleet',
  standalone: true,
  imports: [
    VehicleStatsComponent,
    VehicleListComponent,
    VehicleFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-vehicle-stats [stats]="stats()" [loading]="loading()"></app-vehicle-stats>
      </div>

      <!-- List -->
      <app-vehicle-list
        [vehicles]="vehicles()"
        [loading]="loading()"
        [totalItems]="total_items()"
        [currentPage]="filters().page || 1"
        [limit]="filters().limit || 10"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (remove)="deleteVehicle($event)"
        (searchChange)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (pageChange)="onPageChange($event)"
      ></app-vehicle-list>

      <!-- Form Modal -->
      <app-vehicle-form-modal
        [is_open]="is_modal_open()"
        [vehicle]="selected_vehicle()"
        [saving]="saving()"
        (save)="onSave($event)"
        (closed)="closeModal()"
      ></app-vehicle-form-modal>
    </div>
  `,
})
export class FleetComponent {
  private fleetService = inject(FleetService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);

  // Data
  readonly vehicles = signal<Vehicle[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly total_items = signal(0);

  // Filters / pagination
  readonly filters = signal<VehicleListQuery>({ page: 1, limit: 10 });
  private search_term = '';
  private is_active_filter: boolean | undefined = undefined;

  // Modal
  readonly is_modal_open = signal(false);
  readonly selected_vehicle = signal<Vehicle | null>(null);

  // Stats derived from current page + totals (no dedicated stats endpoint)
  readonly stats = computed<VehicleStats>(() => {
    const list = this.vehicles();
    const active = list.filter((v) => v.is_active).length;
    return {
      total: this.total_items(),
      active,
      inactive: Math.max(this.total_items() - active, 0),
    };
  });

  constructor() {
    this.loadVehicles();
  }

  loadVehicles(): void {
    this.loading.set(true);
    const query: VehicleListQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.search_term) query.search = this.search_term;
    if (this.is_active_filter !== undefined) query.is_active = this.is_active_filter;

    this.fleetService
      .list(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.vehicles.set(response.data || []);
          this.total_items.set(response.pagination?.total ?? (response.data?.length || 0));
          this.loading.set(false);
        },
        error: (error) => {
          this.toastService.error(error?.message || 'Error al cargar los vehículos');
          this.loading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.search_term = term;
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadVehicles();
  }

  onFilterChange(values: { is_active?: boolean }): void {
    this.is_active_filter = values.is_active;
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadVehicles();
  }

  onClearFilters(): void {
    this.search_term = '';
    this.is_active_filter = undefined;
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadVehicles();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadVehicles();
  }

  openCreateModal(): void {
    this.selected_vehicle.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(vehicle: Vehicle): void {
    this.selected_vehicle.set(vehicle);
    this.is_modal_open.set(true);
  }

  closeModal(): void {
    this.is_modal_open.set(false);
    this.selected_vehicle.set(null);
  }

  onSave(dto: CreateVehicleDto): void {
    this.saving.set(true);
    const editing = this.selected_vehicle();
    const request$ = editing
      ? this.fleetService.update(editing.id, dto)
      : this.fleetService.create(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.success(
          editing ? 'Vehículo actualizado' : 'Vehículo creado',
        );
        this.saving.set(false);
        this.closeModal();
        this.loadVehicles();
      },
      error: (error) => {
        this.toastService.error(error?.message || 'Error al guardar el vehículo');
        this.saving.set(false);
      },
    });
  }

  async deleteVehicle(vehicle: Vehicle): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Vehículo',
      message: `¿Eliminar el vehículo ${vehicle.plate}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.fleetService
      .delete(vehicle.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Vehículo eliminado');
          this.loadVehicles();
        },
        error: (error) => {
          this.toastService.error(error?.message || 'Error al eliminar el vehículo');
        },
      });
  }
}
