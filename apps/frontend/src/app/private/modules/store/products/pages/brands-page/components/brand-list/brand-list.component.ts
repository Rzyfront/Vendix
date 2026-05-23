import { Component, computed, input, output, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';

// Shared Components
import {
  ButtonComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../../../shared/components/index';

// Interfaces
import { Brand } from '../../../../interfaces';

@Component({
  selector: 'app-brand-list',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    InputsearchComponent,
    IconComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
  ],
  templateUrl: './brand-list.component.html',
})
export class BrandListComponent {
  readonly brands = input<Brand[]>([]);
  readonly isLoading = input(false);
  readonly totalItems = input(0);
  readonly currentPage = input(1);
  readonly totalPages = input(1);
  readonly limit = input(10);

  /** Granular permission flags driven by the parent page. */
  readonly canCreate = input(false);
  readonly canUpdate = input(false);
  readonly canDelete = input(false);

  readonly refresh = output<void>();
  readonly search = output<string>();
  readonly filter = output<FilterValues>();
  readonly create = output<void>();
  readonly edit = output<Brand>();
  readonly toggleState = output<Brand>();
  readonly delete = output<Brand>();
  readonly sort = output<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();
  readonly pageChange = output<number>();

  searchTerm = signal('');
  selectedState = signal('');

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'active', label: 'Activas' },
        { value: 'inactive', label: 'Inactivas' },
      ],
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions — "Nueva marca" is hidden when the user cannot create.
  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const baseActions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      baseActions.push({
        label: 'Nueva marca',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return baseActions;
  });

  // Table Configuration
  tableColumns: TableColumn[] = [
    {
      key: 'logo_url',
      label: 'Logo',
      type: 'image',
      width: '80px',
      priority: 3,
      defaultValue: '',
    },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, priority: 3 },
    {
      key: 'description',
      label: 'Descripción',
      defaultValue: '—',
      priority: 4,
    },
    {
      key: 'state',
      label: 'Estado',
      priority: 1,
      transform: (value: string) =>
        value === 'active' ? 'Activo' : 'Inactivo',
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
  ];

  // Row-level actions: edit / toggle / delete gated by granular permissions.
  readonly tableActions = computed<TableAction[]>(() => {
    const actions: TableAction[] = [];

    if (this.canUpdate()) {
      actions.push({
        label: 'Editar',
        icon: 'pencil',
        variant: 'info',
        action: (item: Brand) => this.edit.emit(item),
      });
      actions.push({
        label: (item: Brand) =>
          item.state === 'active' ? 'Desactivar' : 'Activar',
        icon: (item: Brand) =>
          item.state === 'active' ? 'toggle-right' : 'toggle-left',
        variant: (item: Brand) =>
          item.state === 'active' ? 'warning' : 'success',
        tooltip: (item: Brand) =>
          item.state === 'active' ? 'Desactivar marca' : 'Activar marca',
        action: (item: Brand) => this.toggleState.emit(item),
      });
    }

    if (this.canDelete()) {
      actions.push({
        label: 'Eliminar',
        icon: 'trash-2',
        variant: 'danger',
        action: (item: Brand) => this.delete.emit(item),
      });
    }

    return actions;
  });

  // Card Config for mobile — uses logo_url for avatar; fallback to "tag" icon.
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'slug',
    avatarKey: 'logo_url',
    avatarFallbackIcon: 'tag',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: string) => (val === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'description', label: 'Descripción' },
    ],
  };

  // Event Handlers
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedState.set((values['state'] as string) || '');
    this.filter.emit(values);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedState.set('');
    this.filterValues = {};
    this.search.emit('');
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        if (!this.canCreate()) return;
        this.create.emit();
        break;
      case 'refresh':
        this.refresh.emit();
        break;
    }
  }

  /** Row click opens edit modal — only when user can update. */
  onRowClick(brand: Brand): void {
    if (!this.canUpdate()) return;
    this.edit.emit(brand);
  }

  // Helper methods
  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna marca coincide con sus filtros'
      : 'No se encontraron marcas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience agregando una nueva marca.';
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm() || this.selectedState());
  }
}
