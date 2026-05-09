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
  OrgAdjustment,
  OrgAdjustmentStatus,
  OrgAdjustmentType,
} from '../../../interfaces/org-adjustment.interface';

interface AdjustmentRow extends OrgAdjustment {
  computed_status: OrgAdjustmentStatus;
}

const TYPE_LABELS: Record<OrgAdjustmentType, string> = {
  damage: 'Daño',
  loss: 'Pérdida',
  theft: 'Robo',
  expiration: 'Vencido',
  count_variance: 'Conteo',
  manual_correction: 'Corrección',
};

const STATUS_LABELS: Record<OrgAdjustmentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  cancelled: 'Cancelado',
};

@Component({
  selector: 'app-org-adjustment-list',
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
              Ajustes ({{ paginationData().total || rows().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar ajuste..."
                [debounceTime]="300"
                (searchChange)="onSearchChange($event)"
              />
              @if (canCreate()) {
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="onActionClick('create')"
                  title="Nuevo ajuste"
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
            <p class="mt-2 text-text-secondary">Cargando ajustes...</p>
          </div>
        }

        @if (!isLoading() && rows().length === 0) {
          <app-empty-state
            icon="clipboard-list"
            [title]="emptyTitle()"
            [description]="emptyDescription()"
            actionButtonText="Crear ajuste"
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
              emptyMessage="No hay ajustes"
              emptyIcon="clipboard-list"
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
export class OrgAdjustmentListComponent {
  readonly adjustments = input.required<OrgAdjustment[]>();
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
  readonly viewDetail = output<OrgAdjustment>();
  readonly approve = output<OrgAdjustment>();
  readonly cancel = output<OrgAdjustment>();
  readonly pageChange = output<number>();

  searchTerm = '';
  filterValues: FilterValues = {};

  readonly rows = computed<AdjustmentRow[]>(() =>
    this.adjustments().map((a) => ({
      ...a,
      computed_status: this.deriveStatus(a),
    })),
  );

  filterConfigs: FilterConfig[] = [
    {
      key: 'type',
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
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'approved', label: 'Aprobado' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const actions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      actions.push({
        label: 'Nuevo ajuste',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return actions;
  });

  tableColumns: TableColumn[] = [
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (v: string) =>
        v ? new Date(v).toLocaleDateString('es-CO') : '-',
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
      transform: (_: string, row: any) => this.locationLabel(row),
    },
    {
      key: 'adjustment_type',
      label: 'Tipo',
      priority: 2,
      transform: (v: OrgAdjustmentType) => TYPE_LABELS[v] ?? v,
    },
    {
      key: 'quantity_change',
      label: 'Cambio',
      align: 'right',
      priority: 1,
      transform: (v: number) => (v > 0 ? `+${v}` : `${v}`),
      cellStyle: (v: number) => ({
        color:
          v > 0
            ? 'var(--color-success)'
            : v < 0
              ? 'var(--color-error, #ef4444)'
              : '',
        'font-weight': v !== 0 ? '700' : '',
      }),
    },
    {
      key: 'computed_status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#f59e0b',
          approved: '#22c55e',
          cancelled: '#9ca3af',
        },
      },
      transform: (v: OrgAdjustmentStatus) => STATUS_LABELS[v] ?? v,
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (item: OrgAdjustment) => this.viewDetail.emit(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'products.name',
    titleTransform: (item: any) => item?.products?.name || 'Sin producto',
    subtitleKey: 'adjustment_type',
    subtitleTransform: (val: OrgAdjustmentType) => TYPE_LABELS[val] ?? val,
    badgeKey: 'computed_status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#f59e0b',
        approved: '#22c55e',
        cancelled: '#9ca3af',
      },
    },
    badgeTransform: (val: OrgAdjustmentStatus) => STATUS_LABELS[val] ?? val,
    footerKey: 'quantity_change',
    footerLabel: 'Cambio',
    footerStyle: 'prominent',
    footerTransform: (val: number) => (val > 0 ? `+${val}` : `${val}`),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) =>
          val ? new Date(val).toLocaleDateString('es-CO') : '-',
      },
      {
        key: 'inventory_locations.name',
        label: 'Ubicación',
        icon: 'map-pin',
        transform: (_val: string, row: any) => this.locationLabel(row),
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
      ? 'Ningún ajuste coincide con los filtros'
      : 'No hay ajustes registrados',
  );
  readonly emptyDescription = computed(() =>
    this.hasFilters()
      ? 'Intenta ajustar los términos de búsqueda o filtros'
      : 'Crea un nuevo ajuste con el botón +',
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

  private deriveStatus(a: OrgAdjustment): OrgAdjustmentStatus {
    // Backend has no `status` column for adjustments; we derive it.
    if (a.approved_by_user_id != null) return 'approved';
    return 'pending';
  }

  private locationLabel(row: OrgAdjustment): string {
    const name = row.inventory_locations?.name ?? '-';
    if (row.inventory_locations?.is_central_warehouse) {
      return `Bodega Central · ${name}`;
    }
    return name;
  }
}
