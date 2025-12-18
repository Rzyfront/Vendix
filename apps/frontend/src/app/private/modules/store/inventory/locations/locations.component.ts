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
    ToastService,
    DialogService,
    IconComponent,
    SelectorComponent,
    SelectorOption,
} from '../../../../../shared/components/index';

// Services
import { LocationsService } from '../services';

// Interfaces
import { InventoryLocation, CreateLocationDto, UpdateLocationDto } from '../interfaces';

// Child Components
import { LocationFormModalComponent } from './components/location-form-modal.component';

@Component({
    selector: 'app-locations',
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
        LocationFormModalComponent,
    ],
    template: `
    <div class="p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <app-stats
          title="Total Ubicaciones"
          [value]="stats.total"
          iconName="map-pin"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Almacenes"
          [value]="stats.warehouses"
          iconName="warehouse"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats.active"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivas"
          [value]="stats.inactive"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Locations List Container -->
      <div class="bg-surface rounded-card shadow-card border border-border min-h-[600px]">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Ubicaciones ({{ stats.total }})
              </h2>
            </div>

            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <app-inputsearch
                class="w-full sm:w-48 flex-shrink-0"
                size="sm"
                placeholder="Buscar ubicación..."
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
                  (clicked)="loadLocations()"
                  [disabled]="is_loading"
                  title="Refrescar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateModal()"
                  title="Nueva Ubicación"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nueva Ubicación</span>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="is_loading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando ubicaciones...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!is_loading && filtered_locations.length === 0" class="p-12 text-center text-gray-500">
          <app-icon name="map-pin" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay ubicaciones</h3>
          <p class="mt-1">Comienza agregando una nueva ubicación para tu inventario.</p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Agregar Ubicación
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_locations.length > 0" class="p-6">
          <app-table
            [data]="filtered_locations"
            [columns]="table_columns"
            [actions]="table_actions"
            [loading]="is_loading"
            [hoverable]="true"
            [striped]="true"
            size="md"
            emptyMessage="No hay ubicaciones registradas"
            (sort)="onSort($event)"
            (rowClick)="onRowClick($event)"
          ></app-table>
        </div>
      </div>

      <!-- Create/Edit Modal -->
      <app-location-form-modal
        [isOpen]="is_modal_open"
        [location]="selected_location"
        [isSubmitting]="is_submitting"
        (cancel)="closeModal()"
        (save)="onSaveLocation($event)"
      ></app-location-form-modal>
    </div>
  `,
})
export class LocationsComponent implements OnInit, OnDestroy {
    // Data
    locations: InventoryLocation[] = [];
    filtered_locations: InventoryLocation[] = [];
    selected_location: InventoryLocation | null = null;

    // Stats
    stats = {
        total: 0,
        active: 0,
        inactive: 0,
        warehouses: 0,
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
        { key: 'code', label: 'Código', sortable: true, width: '120px' },
        { key: 'name', label: 'Nombre', sortable: true },
        {
            key: 'type',
            label: 'Tipo',
            sortable: true,
            transform: (value: string) => {
                const types: any = {
                    'warehouse': 'Almacén',
                    'store': 'Tienda',
                    'virtual': 'Virtual',
                    'transit': 'Tránsito'
                };
                return types[value] || value;
            }
        },
        {
            key: 'is_active',
            label: 'Estado',
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
            variant: 'ghost',
            action: (item: InventoryLocation) => this.openEditModal(item),
        },
        {
            label: 'Eliminar',
            icon: 'trash-2',
            variant: 'danger',
            action: (item: InventoryLocation) => this.confirmDelete(item),
        },
    ];

    // UI State
    is_loading = false;
    is_modal_open = false;
    is_submitting = false;

    private subscriptions: Subscription[] = [];

    constructor(
        private locationsService: LocationsService,
        private toastService: ToastService,
        private dialogService: DialogService
    ) { }

    ngOnInit(): void {
        this.loadLocations();
    }

    ngOnDestroy(): void {
        this.subscriptions.forEach((sub) => sub.unsubscribe());
    }

    // ============================================================
    // Data Loading
    // ============================================================

    loadLocations(): void {
        this.is_loading = true;
        const query = this.search_term ? { search: this.search_term } : {};

        const sub = this.locationsService.getLocations(query).subscribe({
            next: (response) => {
                if (response.data) {
                    this.locations = response.data;
                    this.applyFilters();
                    this.calculateStats();
                }
                this.is_loading = false;
            },
            error: (error) => {
                this.toastService.error(error || 'Error al cargar ubicaciones');
                this.is_loading = false;
            },
        });
        this.subscriptions.push(sub);
    }

    applyFilters(): void {
        let filtered = [...this.locations];

        if (this.status_filter === 'active') {
            filtered = filtered.filter((l) => l.is_active);
        } else if (this.status_filter === 'inactive') {
            filtered = filtered.filter((l) => !l.is_active);
        }

        if (this.search_term) {
            const term = this.search_term.toLowerCase();
            filtered = filtered.filter(
                (l) =>
                    l.name?.toLowerCase().includes(term) ||
                    l.code?.toLowerCase().includes(term)
            );
        }

        this.filtered_locations = filtered;
    }

    calculateStats(): void {
        this.stats.total = this.locations.length;
        this.stats.active = this.locations.filter((l) => l.is_active).length;
        this.stats.inactive = this.locations.filter((l) => !l.is_active).length;
        this.stats.warehouses = this.locations.filter((l) => l.type === 'warehouse').length;
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
            this.loadLocations();
            return;
        }
        // Client-side sorting
        this.locations = [...this.locations].sort((a, b) => {
            const val_a = (a as any)[event.column] || '';
            const val_b = (b as any)[event.column] || '';
            const comparison = String(val_a).localeCompare(String(val_b));
            return event.direction === 'asc' ? comparison : -comparison;
        });
    }

    onRowClick(location: InventoryLocation): void {
        this.openEditModal(location);
    }

    // ============================================================
    // Modal Management
    // ============================================================

    openCreateModal(): void {
        this.selected_location = null;
        this.is_modal_open = true;
    }

    openEditModal(location: InventoryLocation): void {
        this.selected_location = location;
        this.is_modal_open = true;
    }

    closeModal(): void {
        this.is_modal_open = false;
        this.selected_location = null;
    }

    // ============================================================
    // CRUD Operations
    // ============================================================

    onSaveLocation(data: CreateLocationDto | UpdateLocationDto): void {
        this.is_submitting = true;

        if (this.selected_location) {
            // Update
            const sub = this.locationsService
                .updateLocation(this.selected_location.id, data)
                .subscribe({
                    next: () => {
                        this.toastService.success('Ubicación actualizada correctamente');
                        this.is_submitting = false;
                        this.closeModal();
                        this.loadLocations();
                    },
                    error: (error) => {
                        this.toastService.error(error || 'Error al actualizar ubicación');
                        this.is_submitting = false;
                    },
                });
            this.subscriptions.push(sub);
        } else {
            // Create
            const sub = this.locationsService.createLocation(data as CreateLocationDto).subscribe({
                next: () => {
                    this.toastService.success('Ubicación creada correctamente');
                    this.is_submitting = false;
                    this.closeModal();
                    this.loadLocations();
                },
                error: (error) => {
                    this.toastService.error(error || 'Error al crear ubicación');
                    this.is_submitting = false;
                },
            });
            this.subscriptions.push(sub);
        }
    }

    confirmDelete(location: InventoryLocation): void {
        this.dialogService
            .confirm({
                title: 'Eliminar Ubicación',
                message: `¿Está seguro de que desea eliminar la ubicación "${location.name}"? Se marcará como inactiva.`,
                confirmText: 'Eliminar',
                cancelText: 'Cancelar',
                confirmVariant: 'danger',
            })
            .then((confirmed) => {
                if (confirmed) {
                    this.deleteLocation(location);
                }
            });
    }

    deleteLocation(location: InventoryLocation): void {
        const sub = this.locationsService.deleteLocation(location.id).subscribe({
            next: () => {
                this.toastService.success('Ubicación eliminada correctamente');
                this.loadLocations();
            },
            error: (error) => {
                this.toastService.error(error || 'Error al eliminar ubicación');
            },
        });
        this.subscriptions.push(sub);
    }
}
