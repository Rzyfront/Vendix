import { Component, computed, input, output } from '@angular/core';

import {
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
} from '../../../../../../../shared/components/index';
import {
  normalizeOrgTransferStatus,
  OrgTransfer,
  OrgTransferStatus,
} from '../../../interfaces/org-transfer.interface';

const STATUS_LABELS: Record<
  Exclude<OrgTransferStatus, 'draft' | 'completed'>,
  string
> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  in_transit: 'En tránsito',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#9ca3af',
  approved: '#3b82f6',
  in_transit: '#f59e0b',
  received: '#10b981',
  cancelled: '#ef4444',
};

interface TransferRow extends OrgTransfer {
  computed_status: Exclude<OrgTransferStatus, 'draft' | 'completed'>;
  origin_label: string;
  destination_label: string;
}

@Component({
  selector: 'app-org-transfer-list',
  standalone: true,
  imports: [
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <div class="md:space-y-4">
      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Transferencias ({{ paginationData().total || rows().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar transferencia..."
                [debounceTime]="300"
                (searchChange)="onSearchChange($event)"
              />
              @if (canCreate()) {
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="onActionClick('create')"
                  title="Nueva transferencia"
                >
                  <app-icon slot="icon" name="plus" [size]="18" />
                </app-button>
              }
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions()"
                [isLoading]="isLoading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onClearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        @if (isLoading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando transferencias...</p>
          </div>
        }

        @if (!isLoading() && rows().length === 0) {
          <app-empty-state
            icon="repeat"
            [title]="emptyTitle()"
            [description]="emptyDescription()"
            actionButtonText="Crear transferencia"
            [showActionButton]="canCreate() && !hasFilters()"
            [showRefreshButton]="true"
            [showClearFilters]="hasFilters()"
            (actionClick)="onActionClick('create')"
            (refreshClick)="onActionClick('refresh')"
            (clearFiltersClick)="onClearFilters()"
          />
        }

        @if (!isLoading() && rows().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="tableColumns"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="isLoading()"
              [sortable]="true"
              emptyMessage="No hay transferencias"
              emptyIcon="repeat"
            />
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="paginationData().page"
                [totalPages]="paginationData().totalPages"
                [total]="paginationData().total"
                [limit]="paginationData().limit"
                infoStyle="none"
                (pageChange)="pageChange.emit($event)"
              />
            </div>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgTransferListComponent {
  readonly transfers = input.required<OrgTransfer[]>();
  readonly isLoading = input(false);
  readonly canCreate = input(false);
  readonly paginationData = input({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });

  readonly search = output<string>();
  readonly filterChange = output<FilterValues>();
  readonly clearFilters = output<void>();
  readonly actionClick = output<string>();
  readonly viewDetail = output<OrgTransfer>();
  readonly pageChange = output<number>();

  searchTerm = '';
  filterValues: FilterValues = {};

  readonly rows = computed<TransferRow[]>(() =>
    this.transfers().map((t) => ({
      ...t,
      computed_status: normalizeOrgTransferStatus(t.status),
      origin_label: this.locationLabel(t.from_location, t),
      destination_label: this.locationLabel(t.to_location, t, true),
    })),
  );

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'approved', label: 'Aprobada' },
        { value: 'in_transit', label: 'En tránsito' },
        { value: 'received', label: 'Recibida' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const actions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      actions.push({
        label: 'Nueva transferencia',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return actions;
  });

  tableColumns: TableColumn[] = [
    {
      key: 'transfer_number',
      label: 'N° Transferencia',
      sortable: true,
      priority: 1,
    },
    {
      key: 'origin_label',
      label: 'Origen',
      priority: 2,
      defaultValue: '-',
    },
    {
      key: 'destination_label',
      label: 'Destino',
      priority: 2,
      defaultValue: '-',
    },
    {
      key: 'computed_status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLOR },
      transform: (v: string) =>
        STATUS_LABELS[v as Exclude<OrgTransferStatus, 'draft' | 'completed'>] ?? v,
    },
    {
      key: 'stock_transfer_items',
      label: 'Items',
      align: 'center',
      priority: 3,
      transform: (v: any[]) => `${v?.length ?? 0}`,
    },
    {
      key: 'transfer_date',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (v: string) =>
        v ? new Date(v).toLocaleDateString('es-CO') : '-',
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (item: OrgTransfer) => this.viewDetail.emit(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'transfer_number',
    subtitleKey: 'origin_label',
    subtitleTransform: (item: TransferRow) =>
      `${item?.origin_label || '-'} → ${item?.destination_label || '-'}`,
    badgeKey: 'computed_status',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLOR },
    badgeTransform: (val: string) =>
      STATUS_LABELS[val as Exclude<OrgTransferStatus, 'draft' | 'completed'>] ??
      val,
    footerKey: 'stock_transfer_items',
    footerLabel: 'Items',
    footerStyle: 'prominent',
    footerTransform: (val: any[]) => `${val?.length ?? 0}`,
    detailKeys: [
      {
        key: 'transfer_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) =>
          val ? new Date(val).toLocaleDateString('es-CO') : '-',
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

  readonly hasFilters = computed(
    () =>
      !!(
        this.searchTerm ||
        Object.keys(this.filterValues).some((k) => this.filterValues[k])
      ),
  );

  readonly emptyTitle = computed(() =>
    this.hasFilters()
      ? 'Ninguna transferencia coincide con los filtros'
      : 'No hay transferencias registradas',
  );
  readonly emptyDescription = computed(() =>
    this.hasFilters()
      ? 'Intenta ajustar los términos de búsqueda o filtros'
      : 'Crea una transferencia para mover stock entre tiendas o desde la bodega central.',
  );

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

  /**
   * Adds an inline badge to clarify whether a side of the transfer is the
   * central warehouse or a specific store.
   */
  private locationLabel(
    loc: OrgTransfer['from_location'],
    parent: OrgTransfer,
    _isDestination = false,
  ): string {
    if (!loc) return '-';
    const isCentral = loc.store_id == null;
    const tag = isCentral ? '📦 Bodega Central' : '🏪 Tienda';
    void parent; // currently unused — placeholder for future store-name lookup
    return `${tag} · ${loc.name}`;
  }
}
