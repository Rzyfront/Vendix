import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
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
} from '../../../../../../../shared/components/index';

// Interfaces
import { Supplier } from '../../../interfaces';

@Component({
  selector: 'app-supplier-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    InputsearchComponent,
    IconComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './supplier-list.component.html',
})
export class SupplierListComponent {
  @Input() suppliers: Supplier[] = [];
  @Input() isLoading = false;

  @Output() refresh = new EventEmitter<void>();
  @Output() search = new EventEmitter<string>();
  @Output() filter = new EventEmitter<FilterValues>();
  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Supplier>();
  @Output() delete = new EventEmitter<Supplier>();
  @Output() sort = new EventEmitter<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  searchTerm = '';
  selectedStatus = '';

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
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

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nuevo Proveedor', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  // Table Configuration
  tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, width: '100px', priority: 3 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'contact_person', label: 'Contacto', defaultValue: '-', priority: 2 },
    { key: 'email', label: 'Email', defaultValue: '-', priority: 2 },
    { key: 'phone', label: 'Teléfono', defaultValue: '-', priority: 3 },
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

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: Supplier) => this.edit.emit(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Supplier) => this.delete.emit(item),
    },
  ];

  // Card Config for mobile - enhanced with avatar fallback
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'contact_person',
    avatarFallbackIcon: 'building-2',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'code', label: 'Código', icon: 'hash' },
      { key: 'email', label: 'Email', icon: 'mail' },
    ],
    footerKey: 'phone',
    footerLabel: 'Teléfono',
  };

  // Event Handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedStatus = (values['is_active'] as string) || '';
    this.filter.emit(values);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.filterValues = {};
    this.search.emit('');
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'refresh':
        this.refresh.emit();
        break;
    }
  }

  // Helper methods
  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún proveedor coincide con sus filtros'
      : 'No se encontraron proveedores';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience agregando un nuevo proveedor.';
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.selectedStatus);
  }
}
