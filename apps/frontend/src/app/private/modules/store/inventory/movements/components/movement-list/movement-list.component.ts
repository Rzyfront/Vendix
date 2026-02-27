import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Shared Components
import {
  InputsearchComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  IconComponent,
  ButtonComponent,
} from '../../../../../../../shared/components/index';

// Interfaces
import { InventoryMovement, MovementType } from '../../../interfaces';

@Component({
  selector: 'app-movement-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './movement-list.component.html',
})
export class MovementListComponent {
  // Inputs
  readonly movements = input.required<InventoryMovement[]>();
  readonly isLoading = input<boolean>(false);

  // Outputs
  readonly search = output<string>();
  readonly filterChange = output<FilterValues>();
  readonly clearFilters = output<void>();
  readonly actionClick = output<string>();
  readonly viewDetail = output<InventoryMovement>();

  // Local state
  searchTerm = '';
  filterValues: FilterValues = {};

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'movement_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos los tipos' },
        { value: 'stock_in', label: 'Entrada' },
        { value: 'stock_out', label: 'Salida' },
        { value: 'transfer', label: 'Transferencia' },
        { value: 'adjustment', label: 'Ajuste' },
        { value: 'sale', label: 'Venta' },
        { value: 'return', label: 'Devolución' },
        { value: 'damage', label: 'Daño' },
        { value: 'expiration', label: 'Vencimiento' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
  ];

  // Table Configuration
  tableColumns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (value: string) =>
        new Date(value).toLocaleDateString('es-CO'),
    },
    {
      key: 'products.name',
      label: 'Producto',
      sortable: true,
      defaultValue: '-',
      priority: 1,
    },
    {
      key: 'movement_type',
      label: 'Tipo',
      priority: 1,
      transform: (value: MovementType) => this.getTypeLabel(value),
    },
    {
      key: 'quantity',
      label: 'Cantidad',
      align: 'right',
      priority: 1,
    },
    {
      key: 'to_location.name',
      label: 'Destino',
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'reason',
      label: 'Razón',
      defaultValue: '-',
      priority: 3,
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: InventoryMovement) => this.viewDetail.emit(item),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'products.name',
    titleTransform: (item: any) =>
      item.products?.name || 'Sin producto',
    subtitleKey: 'movement_type',
    subtitleTransform: (val: MovementType) => this.getTypeLabel(val),
    badgeKey: 'movement_type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        stock_in: '#22c55e',
        stock_out: '#ef4444',
        transfer: '#8b5cf6',
        adjustment: '#3b82f6',
        sale: '#f59e0b',
        return: '#06b6d4',
        damage: '#dc2626',
        expiration: '#6b7280',
      },
    },
    badgeTransform: (val: MovementType) => this.getTypeLabel(val),
    footerKey: 'quantity',
    footerLabel: 'Cantidad',
    footerStyle: 'prominent',
    footerTransform: (val: number, item?: any) =>
      this.formatQuantity(val, item?.movement_type),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) =>
          new Date(val).toLocaleDateString('es-CO'),
      },
      {
        key: 'to_location.name',
        label: 'Destino',
        icon: 'map-pin',
        transform: (val: any) => val || '-',
      },
    ],
  };

  // Computed
  readonly hasFilters = computed(() => {
    return !!(
      this.searchTerm ||
      Object.keys(this.filterValues).some((k) => this.filterValues[k])
    );
  });

  // Event Handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filterChange.emit(values);
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.filterValues = {};
    this.clearFilters.emit();
  }

  onActionClick(action: string): void {
    this.actionClick.emit(action);
  }

  // Helpers
  getTypeLabel(type: MovementType): string {
    const labels: Record<MovementType, string> = {
      stock_in: 'Entrada',
      stock_out: 'Salida',
      transfer: 'Transferencia',
      adjustment: 'Ajuste',
      sale: 'Venta',
      return: 'Devolución',
      damage: 'Daño',
      expiration: 'Vencimiento',
    };
    return labels[type] || type;
  }

  formatQuantity(value: number, type: MovementType): string {
    const isInbound =
      type === 'stock_in' || type === 'return';
    return isInbound ? `+${value}` : `-${value}`;
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ningún movimiento coincide con sus filtros'
      : 'No hay movimientos de inventario';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Los movimientos se generan automáticamente al realizar operaciones de inventario.';
  }
}
