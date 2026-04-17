import { Component, input, output, computed } from '@angular/core';


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
  CardComponent,
} from '../../../../../../shared/components/index';

import { StockTransfer, TransferStatus } from '../interfaces';

@Component({
  selector: 'app-transfer-list',
  standalone: true,
  imports: [
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    ButtonComponent,
    CardComponent
],
  template: `
    <div class="md:space-y-4">
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Transferencias ({{ transfers().length }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar transferencia..."
                [debounceTime]="300"
                (searchChange)="onSearchChange($event)"
              >
              </app-inputsearch>

              <app-button
                variant="outline"
                size="md"
                customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="onActionClick('create')"
                title="Nueva Transferencia"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions"
                [isLoading]="isLoading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onClearFilters()"
                (actionClick)="onActionClick($event)"
              >
              </app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Loading -->
        @if (isLoading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando transferencias...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!isLoading() && transfers().length === 0) {
          <div class="p-8 md:p-12 text-center text-gray-500">
            <app-icon
              name="repeat"
              [size]="48"
              class="mx-auto mb-4 text-gray-300"
            ></app-icon>
            <h3 class="text-lg font-medium text-gray-900">
              {{ getEmptyStateTitle() }}
            </h3>
            <p class="mt-1 text-sm text-text-secondary">
              {{ getEmptyStateDescription() }}
            </p>

            @if (hasFilters()) {
              <div class="mt-6 flex justify-center gap-3">
                <app-button variant="outline" (clicked)="onClearFilters()"
                  >Limpiar filtros</app-button
                >
              </div>
            } @else {
              <div class="mt-6">
                <app-button
                  variant="primary"
                  (clicked)="onActionClick('create')"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Nueva Transferencia
                </app-button>
              </div>
            }
          </div>
        }

        <!-- List -->
        @if (!isLoading() && transfers().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="transfers()"
              [columns]="tableColumns"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="isLoading()"
              [sortable]="true"
              emptyMessage="No hay transferencias"
              emptyIcon="repeat"
            >
            </app-responsive-data-view>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class TransferListComponent {
  readonly transfers = input.required<StockTransfer[]>();
  readonly isLoading = input<boolean>(false);

  readonly search = output<string>();
  readonly filterChange = output<FilterValues>();
  readonly clearFilters = output<void>();
  readonly actionClick = output<string>();
  readonly viewDetail = output<StockTransfer>();
  readonly approve = output<StockTransfer>();
  readonly complete = output<StockTransfer>();
  readonly cancel = output<StockTransfer>();
  readonly deleteTransfer = output<StockTransfer>();

  searchTerm = '';
  filterValues: FilterValues = {};

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'in_transit', label: 'En Tránsito' },
        { value: 'completed', label: 'Completada' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
  ];

  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Nueva Transferencia',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  tableColumns: TableColumn[] = [
    {
      key: 'transfer_number',
      label: 'N° Transferencia',
      sortable: true,
      priority: 1,
    },
    {
      key: 'from_location.name',
      label: 'Origen',
      priority: 2,
      defaultValue: '-',
    },
    {
      key: 'to_location.name',
      label: 'Destino',
      priority: 2,
      defaultValue: '-',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          draft: '#6b7280',
          in_transit: '#f59e0b',
          completed: '#22c55e',
          cancelled: '#ef4444',
        },
      },
      transform: (value: TransferStatus) => this.getStatusLabel(value),
    },
    {
      key: 'stock_transfer_items',
      label: 'Items',
      align: 'center',
      priority: 3,
      transform: (value: any[]) => value?.length?.toString() || '0',
    },
    {
      key: 'transfer_date',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (value: string) => new Date(value).toLocaleDateString('es-CO'),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (item: StockTransfer) => this.viewDetail.emit(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'transfer_number',
    subtitleKey: 'from_location.name',
    subtitleTransform: (item: any) =>
      `${item?.from_location?.name || '-'} → ${item?.to_location?.name || '-'}`,
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        draft: '#94a3b8',
        in_transit: '#3b82f6',
        completed: '#10b981',
        cancelled: '#6b7280',
      },
    },
    badgeTransform: (val: TransferStatus) => this.getStatusLabel(val),
    footerKey: 'stock_transfer_items',
    footerLabel: 'Items',
    footerStyle: 'prominent',
    footerTransform: (val: any[]) => val?.length?.toString() || '0',
    detailKeys: [
      {
        key: 'transfer_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) => new Date(val).toLocaleDateString('es-CO'),
      },
      {
        key: 'expected_date',
        label: 'Esperada',
        icon: 'clock',
        transform: (val: string) =>
          val ? new Date(val).toLocaleDateString('es-CO') : '-',
      },
    ],
  };

  readonly hasFilters = computed(() => {
    return !!(
      this.searchTerm ||
      Object.keys(this.filterValues).some((k) => this.filterValues[k])
    );
  });

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

  getStatusLabel(status: TransferStatus): string {
    const labels: Record<TransferStatus, string> = {
      draft: 'Borrador',
      in_transit: 'En Tránsito',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ninguna transferencia coincide con sus filtros'
      : 'No hay transferencias de inventario';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Crea una transferencia para mover productos entre ubicaciones.';
  }
}
