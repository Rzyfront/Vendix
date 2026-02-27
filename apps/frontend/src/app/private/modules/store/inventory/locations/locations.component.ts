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
    ResponsiveDataViewComponent,
    ItemListCardConfig,
    OptionsDropdownComponent,
    FilterConfig,
    DropdownAction,
    FilterValues,
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
        ResponsiveDataViewComponent,
        InputsearchComponent,
        StatsComponent,
        IconComponent,
        OptionsDropdownComponent,
        LocationFormModalComponent,
    ],
    template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Ubicaciones"
          [value]="stats.total"
          smallText="Registradas en el sistema"
          iconName="map-pin"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Almacenes"
          [value]="stats.warehouses"
          smallText="Puntos de almacenamiento"
          iconName="warehouse"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats.active"
          smallText="Operativas actualmente"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivas"
          [value]="stats.inactive"
          smallText="Fuera de operación"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Locations List Container: mobile-first (no container on mobile, full styling on desktop) -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border md:min-h-[600px] md:overflow-hidden">
        <!-- Search Section: sticky below stats on mobile, normal on desktop -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <!-- Title - smaller on mobile, larger on desktop -->
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Ubicaciones ({{ stats.total }})
            </h2>

            <!-- Search row - horizontal on mobile -->
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar ubicación..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              ></app-inputsearch>

              <app-button
                variant="outline"
                size="sm"
                customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="openCreateModal()"
                title="Nueva Ubicación"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions"
                [isLoading]="is_loading"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="is_loading" class="p-4 md:p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando ubicaciones...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!is_loading && filtered_locations.length === 0" class="p-8 md:p-12 text-center text-gray-500">
          <app-icon name="map-pin" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay ubicaciones</h3>
          <p class="mt-1 text-sm md:text-base">Comienza agregando una nueva ubicación para tu inventario.</p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Agregar Ubicación
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_locations.length > 0" class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filtered_locations"
            [columns]="table_columns"
            [cardConfig]="cardConfig"
            [actions]="table_actions"
            [loading]="is_loading"
            emptyMessage="No hay ubicaciones registradas"
            emptyIcon="map-pin"
            (sort)="onSort($event)"
            (rowClick)="onRowClick($event)"
          ></app-responsive-data-view>
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
    type_filter = '';
    search_term = '';

    // Filter configuration for the options dropdown
    filterConfigs: FilterConfig[] = [
        {
            key: 'is_active',
            label: 'Estado',
            type: 'select',
            options: [
                { value: '', label: 'Todos' },
                { value: 'true', label: 'Activas' },
                { value: 'false', label: 'Inactivas' },
            ],
        },
        {
            key: 'type',
            label: 'Tipo',
            type: 'select',
            options: [
                { value: '', label: 'Todos los Tipos' },
                { value: 'warehouse', label: 'Almacén' },
                { value: 'store', label: 'Tienda' },
                { value: 'virtual', label: 'Virtual' },
                { value: 'transit', label: 'Tránsito' },
            ],
        },
    ];

    // Current filter values
    filterValues: FilterValues = {};

    // Dropdown actions
    dropdownActions: DropdownAction[] = [
        { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
        { label: 'Nueva Ubicación', icon: 'plus', action: 'create', variant: 'primary' },
    ];

    // Table Configuration
    table_columns: TableColumn[] = [
        { key: 'code', label: 'Código', sortable: true, width: '120px', priority: 3 },
        { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
        {
            key: 'type',
            label: 'Tipo',
            sortable: true,
            priority: 2,
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
            action: (item: InventoryLocation) => this.openEditModal(item),
        },
        {
            label: 'Eliminar',
            icon: 'trash-2',
            variant: 'danger',
            action: (item: InventoryLocation) => this.confirmDelete(item),
        },
    ];

    // Card Config for mobile
    cardConfig: ItemListCardConfig = {
        titleKey: 'name',
        subtitleKey: 'code',
        avatarFallbackIcon: 'map-pin',
        avatarShape: 'square',
        badgeKey: 'is_active',
        badgeConfig: { type: 'status', size: 'sm' },
        badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
        footerKey: 'type',
        footerLabel: 'Tipo',
        footerTransform: (value: string) => {
            const types: Record<string, string> = {
                'warehouse': 'Almacén',
                'store': 'Tienda',
                'virtual': 'Virtual',
                'transit': 'Tránsito'
            };
            return types[value] || value;
        },
        detailKeys: [
            {
                key: 'type',
                label: 'Tipo',
                icon: 'warehouse',
                transform: (value: string) => {
                    const types: Record<string, string> = {
                        'warehouse': 'Almacén',
                        'store': 'Tienda',
                        'virtual': 'Virtual',
                        'transit': 'Tránsito'
                    };
                    return types[value] || value;
                }
            },
        ],
    };

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

        if (this.type_filter) {
            filtered = filtered.filter((l) => l.type === this.type_filter);
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

    onFilterChange(values: FilterValues): void {
        this.filterValues = values;
        const isActiveValue = values['is_active'] as string;
        this.type_filter = (values['type'] as string) || '';

        if (isActiveValue === 'true') {
            this.status_filter = 'active';
        } else if (isActiveValue === 'false') {
            this.status_filter = 'inactive';
        } else {
            this.status_filter = 'all';
        }

        this.applyFilters();
    }

    clearFilters(): void {
        this.status_filter = 'all';
        this.type_filter = '';
        this.search_term = '';
        this.filterValues = {};
        this.applyFilters();
    }

    onActionClick(action: string): void {
        switch (action) {
            case 'create':
                this.openCreateModal();
                break;
            case 'refresh':
                this.loadLocations();
                break;
        }
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
