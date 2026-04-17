import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';

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
  PaginationComponent,
  CardComponent,
} from '../../../../../shared/components/index';

// Services
import { LocationsService } from '../services';

// Interfaces
import {
  InventoryLocation,
  CreateLocationDto,
  UpdateLocationDto,
} from '../interfaces';

// Child Components
import { LocationFormModalComponent } from './components/location-form-modal.component';

@Component({
  selector: 'app-locations',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    StatsComponent,
    IconComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    CardComponent,
    LocationFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Ubicaciones"
          [value]="stats().total"
          smallText="Registradas en el sistema"
          iconName="map-pin"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Almacenes"
          [value]="stats().warehouses"
          smallText="Puntos de almacenamiento"
          iconName="warehouse"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats().active"
          smallText="Operativas actualmente"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivas"
          [value]="stats().inactive"
          smallText="Fuera de operación"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Locations List Container: mobile-first (no container on mobile, full styling on desktop) -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section: sticky below stats on mobile, normal on desktop -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <!-- Title - smaller on mobile, larger on desktop -->
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Ubicaciones ({{ pagination().total }})
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
                size="md"
                customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
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
                [isLoading]="is_loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (is_loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando ubicaciones...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!is_loading() && filtered_locations().length === 0) {
          <div class="p-8 md:p-12 text-center text-gray-500">
            <app-icon
              name="map-pin"
              [size]="48"
              class="mx-auto mb-4 text-gray-300"
            ></app-icon>
            <h3 class="text-lg font-medium text-gray-900">
              No hay ubicaciones
            </h3>
            <p class="mt-1 text-sm md:text-base">
              Comienza agregando una nueva ubicación para tu inventario.
            </p>
            <div class="mt-6">
              <app-button variant="primary" (clicked)="openCreateModal()">
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Agregar Ubicación
              </app-button>
            </div>
          </div>
        }

        <!-- Table -->
        @if (!is_loading() && filtered_locations().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="filtered_locations()"
              [columns]="table_columns"
              [cardConfig]="cardConfig"
              [actions]="table_actions"
              [loading]="is_loading()"
              emptyMessage="No hay ubicaciones registradas"
              emptyIcon="map-pin"
              (sort)="onSort($event)"
              (rowClick)="onRowClick($event)"
            ></app-responsive-data-view>
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="pagination().page"
                [totalPages]="pagination().totalPages"
                [total]="pagination().total"
                [limit]="pagination().limit"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          </div>
        }
      </app-card>

      <!-- Create/Edit Modal -->
      <app-location-form-modal
        [isOpen]="is_modal_open()"
        [location]="selected_location()"
        [isSubmitting]="is_submitting()"
        (cancel)="closeModal()"
        (save)="onSaveLocation($event)"
      ></app-location-form-modal>
    </div>
  `,
})
export class LocationsComponent implements OnInit, OnDestroy {
  locations = signal<InventoryLocation[]>([]);
  filtered_locations = computed(() => this.locations());
  selected_location = signal<InventoryLocation | null>(null);

  stats = signal({
    total: 0,
    active: 0,
    inactive: 0,
    warehouses: 0,
  });

  pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

  status_filter: 'all' | 'active' | 'inactive' = 'all';
  type_filter = '';
  search_term = '';

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

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Nueva Ubicación',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  table_columns: TableColumn[] = [
    {
      key: 'code',
      label: 'Código',
      sortable: true,
      width: '120px',
      priority: 3,
    },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'type',
      label: 'Tipo',
      sortable: true,
      priority: 2,
      transform: (value: string) => {
        const types: any = {
          warehouse: 'Almacén',
          store: 'Tienda',
          virtual: 'Virtual',
          transit: 'Tránsito',
        };
        return types[value] || value;
      },
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
      variant: 'info',
      action: (item: InventoryLocation) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: InventoryLocation) => this.confirmDelete(item),
    },
  ];

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
        warehouse: 'Almacén',
        store: 'Tienda',
        virtual: 'Virtual',
        transit: 'Tránsito',
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
            warehouse: 'Almacén',
            store: 'Tienda',
            virtual: 'Virtual',
            transit: 'Tránsito',
          };
          return types[value] || value;
        },
      },
    ],
  };

  is_loading = signal(false);
  is_modal_open = signal(false);
  is_submitting = signal(false);

  private subscriptions: Subscription[] = [];

  constructor(
    private locationsService: LocationsService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    this.loadLocations();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadLocations(): void {
    this.is_loading.set(true);
    const p = this.pagination();
    const query: any = {
      page: p.page,
      limit: p.limit,
      ...(this.search_term ? { search: this.search_term } : {}),
      ...(this.status_filter === 'active' ? { is_active: true } : {}),
      ...(this.status_filter === 'inactive' ? { is_active: false } : {}),
      ...(this.type_filter ? { type: this.type_filter } : {}),
    };

    const sub = this.locationsService.getLocations(query).subscribe({
      next: (response: any) => {
        if (response.data) {
          this.locations.set(response.data);
          if (response.meta) {
            this.pagination.update((pg) => ({
              ...pg,
              total: response.meta.total,
              totalPages: response.meta.totalPages,
            }));
          }
          this.calculateStats();
        }
        if (this.locations().length === 0 && this.pagination().page > 1) {
          this.pagination.update((pg) => ({ ...pg, page: pg.page - 1 }));
          this.loadLocations();
          return;
        }
        this.is_loading.set(false);
      },
      error: (error) => {
        this.toastService.error(error || 'Error al cargar ubicaciones');
        this.is_loading.set(false);
      },
    });
    this.subscriptions.push(sub);
  }

  calculateStats(): void {
    const list = this.locations();
    const pg = this.pagination();
    this.stats.set({
      total: pg.total || list.length,
      active: list.filter((l) => l.is_active).length,
      inactive: list.filter((l) => !l.is_active).length,
      warehouses: list.filter((l) => l.type === 'warehouse').length,
    });
  }

  onSearch(term: string): void {
    this.search_term = term;
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
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

    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
  }

  clearFilters(): void {
    this.status_filter = 'all';
    this.type_filter = '';
    this.search_term = '';
    this.filterValues = {};
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadLocations();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadLocations();
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
    this.locations.update((list) =>
      [...list].sort((a, b) => {
        const val_a = (a as any)[event.column] || '';
        const val_b = (b as any)[event.column] || '';
        const comparison = String(val_a).localeCompare(String(val_b));
        return event.direction === 'asc' ? comparison : -comparison;
      }),
    );
  }

  onRowClick(location: InventoryLocation): void {
    this.openEditModal(location);
  }

  openCreateModal(): void {
    this.selected_location.set(null);
    this.is_modal_open.set(true);
  }

  openEditModal(location: InventoryLocation): void {
    this.selected_location.set(location);
    this.is_modal_open.set(true);
  }

  closeModal(): void {
    this.is_modal_open.set(false);
    this.selected_location.set(null);
  }

  onSaveLocation(data: CreateLocationDto | UpdateLocationDto): void {
    this.is_submitting.set(true);

    const loc = this.selected_location();
    if (loc) {
      const sub = this.locationsService.updateLocation(loc.id, data).subscribe({
        next: () => {
          this.toastService.success('Ubicación actualizada correctamente');
          this.is_submitting.set(false);
          this.closeModal();
          this.loadLocations();
        },
        error: (error) => {
          this.toastService.error(error || 'Error al actualizar ubicación');
          this.is_submitting.set(false);
        },
      });
      this.subscriptions.push(sub);
    } else {
      const sub = this.locationsService
        .createLocation(data as CreateLocationDto)
        .subscribe({
          next: () => {
            this.toastService.success('Ubicación creada correctamente');
            this.is_submitting.set(false);
            this.closeModal();
            this.loadLocations();
          },
          error: (error) => {
            this.toastService.error(error || 'Error al crear ubicación');
            this.is_submitting.set(false);
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
