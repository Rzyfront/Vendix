import { Component, input, output, computed } from '@angular/core';

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
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../../shared/components/index';

// Interfaces
import { InventoryMovement, MovementType } from '../../../interfaces';

/**
 * Tipos que sólo existen como salida. Sirven para desempatar las filas
 * históricas, que se escribieron con `to_location_id` relleno en los dos
 * sentidos y por eso no llevan la dirección en la fila.
 */
const OUTBOUND_ONLY_TYPES = new Set<string>([
  'stock_out',
  'sale',
  'damage',
  'expiration',
  'consumption',
]);

@Component({
  selector: 'app-movement-list',
  standalone: true,
  imports: [
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    CardComponent
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
      transform: (value: number, item?: any) =>
        this.formatQuantity(value, item),
      cellStyle: (_value: number, item?: any) => ({
        color: this.quantityColor(item),
        'font-weight': '700',
      }),
    },
    {
      // Una salida ya no lleva pata de destino, así que la columna fija a
      // `to_location` quedaba vacía justo en los movimientos que sacan stock.
      //
      // Apuntar la columna a `to_location.name` con un `transform` que leía las
      // dos patas NO alcanzaba: `app-table` sólo llama al `transform` cuando el
      // valor crudo de `key` no está vacío, así que en una salida —donde
      // `to_location` es null— el transform nunca corría y la celda caía al
      // `defaultValue`. El arreglo quedaba muerto exactamente en las filas para
      // las que se escribió. Por eso la etiqueta se calcula antes, en la fila.
      key: 'location_label',
      label: 'Ubicación',
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
      variant: 'secondary',
      action: (item: InventoryMovement) => this.viewDetail.emit(item),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'products.name',
    titleTransform: (item: any) => item.products?.name || 'Sin producto',
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
      this.formatQuantity(val, item),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) => new Date(val).toLocaleDateString('es-CO'),
      },
      {
        // Misma razón que en la columna de la tabla: la etiqueta viene ya
        // calculada en la fila, no de `to_location`, que en una salida es null.
        key: 'location_label',
        label: 'Ubicación',
        icon: 'map-pin',
      },
    ],
  };

  /**
   * Filas con la etiqueta de bodega ya resuelta.
   *
   * `app-table` no llama al `transform` de una columna si el valor crudo de su
   * `key` está vacío, así que una etiqueta que se deriva de OTROS campos —aquí,
   * de las dos patas de ubicación— tiene que existir en la fila. Calcularla aquí
   * además ordena por lo que el usuario ve, no por una pata que puede ser null.
   */
  readonly rows = computed(() =>
    this.movements().map((m) => ({
      ...m,
      location_label: this.locationLabel(m),
    })),
  );

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

  /**
   * Dirección real del movimiento.
   *
   * La verdad está en las dos patas de ubicación: sale de donde dice
   * `from_location_id` y entra a donde dice `to_location_id`. Un traslado lleva
   * las dos. Adivinarla por el tipo era el bug: un `adjustment` que subía el
   * stock de 100 a 120 se pintaba "−20", porque `adjustment` no está en la lista
   * de entradas.
   *
   * Las filas históricas se escribieron siempre con `to_location_id` relleno y
   * `from_location_id` en null, incluso en las salidas, así que para ellas no
   * hay dirección recuperable y se conserva la heurística por tipo.
   */
  private isInboundMovement(item: any): boolean {
    const from = item?.from_location_id ?? null;
    const to = item?.to_location_id ?? null;

    // 1) Sólo pata de origen → salió. Concluyente, y es la forma de TODA fila
    //    nueva de salida.
    if (from != null && to == null) return false;

    // 2) Las dos patas → traslado; se muestra desde la pata de destino.
    if (from != null && to != null) return true;

    // 3) Sólo pata de destino: puede ser una entrada nueva o una fila histórica
    //    (el legado rellenaba `to_location_id` en los dos sentidos). Los tipos
    //    que sólo existen en un sentido zanjan el caso; `adjustment` es el único
    //    ambiguo y se resuelve como entrada, porque toda salida nueva ya cayó
    //    por la regla 1.
    return !OUTBOUND_ONLY_TYPES.has(item?.movement_type);
  }

  formatQuantity(value: number, item?: any): string {
    return this.isInboundMovement(item) ? `+${value}` : `-${value}`;
  }

  /** Bodega afectada: destino en las entradas, origen en las salidas. */
  locationLabel(item?: any): string {
    const from = item?.from_location?.name ?? null;
    const to = item?.to_location?.name ?? null;
    if (from && to) return `${from} → ${to}`;
    return to || from || '-';
  }

  quantityColor(item?: any): string {
    return this.isInboundMovement(item)
      ? 'var(--color-success)'
      : 'var(--color-error, #ef4444)';
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
