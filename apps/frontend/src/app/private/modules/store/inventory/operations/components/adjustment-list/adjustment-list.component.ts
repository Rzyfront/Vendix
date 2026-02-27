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
  PaginationComponent,
} from '../../../../../../../shared/components/index';

// Interfaces
import { InventoryAdjustment, AdjustmentType } from '../../../interfaces';

@Component({
  selector: 'app-adjustment-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    ButtonComponent,
    PaginationComponent,
  ],
  templateUrl: './adjustment-list.component.html',
})
export class AdjustmentListComponent {
  // Inputs
  readonly adjustments = input.required<InventoryAdjustment[]>();
  readonly isLoading = input<boolean>(false);
  readonly paginationData = input({ page: 1, limit: 10, total: 0, totalPages: 0 });

  // Outputs
  readonly search = output<string>();
  readonly pageChange = output<number>();
  readonly filterChange = output<FilterValues>();
  readonly clearFilters = output<void>();
  readonly actionClick = output<string>();
  readonly viewDetail = output<InventoryAdjustment>();

  // Local state
  searchTerm = '';
  filterValues: FilterValues = {};

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'adjustment_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos los tipos' },
        { value: 'damage', label: 'Daño' },
        { value: 'loss', label: 'Pérdida' },
        { value: 'theft', label: 'Robo' },
        { value: 'expiration', label: 'Vencido' },
        { value: 'count_variance', label: 'Conteo' },
        { value: 'manual_correction', label: 'Corrección' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nuevo Ajuste', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  // Table Configuration
  tableColumns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (value: string) => new Date(value).toLocaleDateString('es-CO'),
    },
    {
      key: 'products.name',
      label: 'Producto',
      sortable: true,
      defaultValue: '-',
      priority: 1,
    },
    {
      key: 'inventory_locations.name',
      label: 'Ubicación',
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'adjustment_type',
      label: 'Tipo',
      priority: 2,
      transform: (value: AdjustmentType) => this.getTypeLabel(value),
    },
    {
      key: 'quantity_change',
      label: 'Cambio',
      align: 'right',
      priority: 1,
      transform: (value: number) => (value > 0 ? `+${value}` : `${value}`),
    },
    {
      key: 'quantity_before',
      label: 'Antes',
      align: 'right',
      priority: 3,
    },
    {
      key: 'quantity_after',
      label: 'Después',
      align: 'right',
      priority: 3,
    },
    {
      key: 'created_by_user.user_name',
      label: 'Creado por',
      defaultValue: '-',
      priority: 4,
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: InventoryAdjustment) => this.viewDetail.emit(item),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'products.name',
    titleTransform: (item: any) => item.products?.name || item.product?.name || 'Sin producto',
    subtitleKey: 'adjustment_type',
    subtitleTransform: (val: AdjustmentType) => this.getTypeLabel(val),
    badgeKey: 'adjustment_type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        damage: '#f59e0b',
        loss: '#ef4444',
        theft: '#dc2626',
        expiration: '#6b7280',
        count_variance: '#3b82f6',
        manual_correction: '#22c55e',
      },
    },
    badgeTransform: (val: AdjustmentType) => this.getTypeLabel(val),
    footerKey: 'quantity_change',
    footerLabel: 'Cambio',
    footerStyle: 'prominent',
    footerTransform: (val: number) => (val > 0 ? `+${val}` : `${val}`),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) => new Date(val).toLocaleDateString('es-CO'),
      },
      {
        key: 'inventory_locations.name',
        label: 'Ubicación',
        icon: 'map-pin',
        transform: (val: any) => val || '-',
      },
    ],
  };

  // Computed
  readonly hasFilters = computed(() => {
    return !!(this.searchTerm || Object.keys(this.filterValues).some(k => this.filterValues[k]));
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
  getTypeLabel(type: AdjustmentType): string {
    const labels: Record<AdjustmentType, string> = {
      damage: 'Daño',
      loss: 'Pérdida',
      theft: 'Robo',
      expiration: 'Vencido',
      count_variance: 'Conteo',
      manual_correction: 'Corrección',
    };
    return labels[type] || type;
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ningún ajuste coincide con sus filtros'
      : 'No hay ajustes de inventario';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Los ajustes de inventario se registran desde el detalle del producto.';
  }
}
