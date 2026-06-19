import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';

import {
  Vehicle,
  VehicleType,
  VEHICLE_TYPE_LABELS,
} from '../../interfaces/vehicle.interface';

@Component({
  selector: 'app-vehicle-list',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
  ],
  templateUrl: './vehicle-list.component.html',
})
export class VehicleListComponent {
  // Data (owned by parent)
  readonly vehicles = input<Vehicle[]>([]);
  readonly loading = input<boolean>(false);
  readonly totalItems = input<number>(0);
  readonly currentPage = input<number>(1);
  readonly limit = input<number>(10);

  // Outputs
  readonly create = output<void>();
  readonly edit = output<Vehicle>();
  readonly remove = output<Vehicle>();
  readonly searchChange = output<string>();
  readonly filterChange = output<{ is_active?: boolean }>();
  readonly clearFilters = output<void>();
  readonly pageChange = output<number>();

  // Local filter UI state
  readonly search_term = signal('');
  readonly filter_values = signal<FilterValues>({});

  filter_configs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Activos' },
        { value: 'false', label: 'Inactivos' },
      ],
    },
  ];

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nuevo Vehículo',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  table_columns: TableColumn[] = [
    {
      key: 'plate',
      label: 'Placa',
      sortable: true,
      width: '120px',
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      priority: 2,
      transform: (value: VehicleType) => this.getTypeLabel(value),
    },
    {
      key: 'brand',
      label: 'Marca / Modelo',
      priority: 2,
      transform: (_value: any, row?: Vehicle) => this.getBrandModel(row),
    },
    {
      key: 'capacity_kg',
      label: 'Capacidad',
      align: 'right',
      priority: 3,
      transform: (_value: any, row?: Vehicle) => this.getCapacity(row),
    },
    {
      key: 'primary_driver',
      label: 'Conductor',
      priority: 3,
      transform: (_value: any, row?: Vehicle) => this.getDriverName(row),
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: { Activo: '#10b981', Inactivo: '#6b7280' },
      },
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (v: Vehicle) => this.edit.emit(v),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (v: Vehicle) => this.remove.emit(v),
      variant: 'danger',
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'plate',
    titleTransform: (item: Vehicle) => item.plate,
    subtitleTransform: (item: Vehicle) =>
      this.getBrandModel(item) || this.getTypeLabel(item.type),
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { Activo: '#10b981', Inactivo: '#6b7280' },
    },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'type',
        label: 'Tipo',
        transform: (val: VehicleType) => this.getTypeLabel(val),
      },
      {
        key: 'capacity_kg',
        label: 'Capacidad',
        transform: (_val: any, item?: Vehicle) => this.getCapacity(item),
      },
      {
        key: 'primary_driver',
        label: 'Conductor',
        transform: (_val: any, item?: Vehicle) => this.getDriverName(item),
      },
    ],
  };

  // Pagination
  get totalPages(): number {
    return Math.ceil((this.totalItems() || 0) / (this.limit() || 10));
  }

  onPageChange(page: number): void {
    this.pageChange.emit(page);
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set(values);
    const raw = values['is_active'] as string | undefined;
    const is_active =
      raw === '' || raw === undefined ? undefined : raw === 'true';
    this.filterChange.emit({ is_active });
  }

  onClearFilters(): void {
    this.search_term.set('');
    this.filter_values.set({});
    this.clearFilters.emit();
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }

  get hasFilters(): boolean {
    return !!(this.search_term() || this.filter_values()['is_active']);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters ? 'No se encontraron vehículos' : 'No hay vehículos';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intenta ajustar tus filtros para ver más resultados'
      : 'Comienza registrando tu primer vehículo para tu flota de despacho.';
  }

  // Helpers
  getTypeLabel(type?: VehicleType | null): string {
    if (!type) return '-';
    return VEHICLE_TYPE_LABELS[type] || type;
  }

  getBrandModel(v?: Vehicle): string {
    if (!v) return '-';
    const parts = [v.brand, v.model_name].filter(Boolean);
    return parts.length ? parts.join(' ') : '-';
  }

  getCapacity(v?: Vehicle): string {
    if (!v) return '-';
    const parts: string[] = [];
    if (v.capacity_kg !== null && v.capacity_kg !== undefined && `${v.capacity_kg}` !== '') {
      const kg = typeof v.capacity_kg === 'string' ? parseFloat(v.capacity_kg) : v.capacity_kg;
      if (!Number.isNaN(kg) && kg > 0) parts.push(`${kg} kg`);
    }
    if (v.capacity_units !== null && v.capacity_units !== undefined && v.capacity_units > 0) {
      parts.push(`${v.capacity_units} und`);
    }
    return parts.length ? parts.join(' · ') : '-';
  }

  getDriverName(v?: Vehicle): string {
    const d = v?.primary_driver;
    if (!d) return '-';
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
    return name || `#${d.id}`;
  }
}
