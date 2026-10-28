import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { UnitFormModalComponent } from '../../components/unit-form-modal/unit-form-modal.component';
import { UnitTypeFormModalComponent } from '../../components/unit-type-form-modal/unit-type-form-modal.component';
import { UnitType } from '../../interfaces/unit-type.interface';
import {
  HOUSEKEEPING_STATUS_LABELS,
  HousekeepingStatus,
  LodgingUnit,
} from '../../interfaces/unit.interface';
import { LodgingUnitsService } from '../../services/units.service';
import {
  HOUSEKEEPING_STATUS_CHIPS,
  statusBadgeConfig,
} from '../../../shared/hospitality-status';
import { UnitTypesService } from '../../services/unit-types.service';

type RoomsTab = 'types' | 'units';

/**
 * Badge colors shared by the table column and the mobile card. The table
 * looks booleans up as `true`/`false`, the card as `active`/`inactive`.
 */
const ACTIVE_COLOR_MAP: Record<string, string> = {
  true: 'var(--color-success)',
  false: 'var(--color-text-secondary)',
  active: 'var(--color-success)',
  inactive: 'var(--color-text-secondary)',
};

const ACTIVE_BADGE = {
  type: 'custom' as const,
  size: 'sm' as const,
  colorMap: ACTIVE_COLOR_MAP,
};

const HOUSEKEEPING_BADGE = statusBadgeConfig(HOUSEKEEPING_STATUS_CHIPS);

/** Rooms that can be sold tonight: active and clean or inspected. */
const SELLABLE_STATUSES: HousekeepingStatus[] = ['clean', 'inspected'];
/** Rooms withdrawn from sale: out of order or blocked. */
const OFF_SALE_STATUSES: HousekeepingStatus[] = [
  'out_of_order',
  'out_of_service',
];

interface UnitTypeRow extends UnitType {
  capacity: string;
  units: string;
  price: string;
  tax: string;
}

interface UnitRow extends LodgingUnit {
  type_name: string;
  status: string;
}

/** "1 unidad" / "2 unidades": active rooms of a type. */
export function formatUnitCount(count: number): string {
  return `${count} ${count === 1 ? 'unidad' : 'unidades'}`;
}

/** "2 base · máx. 3 adultos + 1 niño" */
export function formatCapacity(u: UnitType): string {
  const children =
    u.max_children > 0
      ? ` + ${u.max_children} ${u.max_children === 1 ? 'niño' : 'niños'}`
      : '';
  const adults = `${u.max_adults} ${u.max_adults === 1 ? 'adulto' : 'adultos'}`;
  return `${u.base_occupancy} base · máx. ${adults}${children}`;
}

const ACTIVE_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

function matchesActive(filter: FilterValues[string], isActive: boolean): boolean {
  if (filter === 'active') return isActive;
  if (filter === 'inactive') return !isActive;
  return true;
}

/**
 * Hospitality Suite — Habitaciones. Standard admin list module: four stats,
 * tabs ("Tipos" / "Unidades") and one card per tab with the sticky search,
 * the dropdown filters and the responsive data view.
 *
 * Pagination exception: room types and rooms are a hotel's physical
 * inventory (tens of rows) and the API returns them whole; the stats need the
 * full set anyway, so search and filters run client-side.
 */
@Component({
  selector: 'app-hospitality-rooms-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SpinnerComponent,
    FormsModule,
    StatsComponent,
    EmptyStateComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ScrollableTabsComponent,
    ResponsiveDataViewComponent,
    UnitTypeFormModalComponent,
    UnitFormModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Tipos de habitación"
          [value]="stats().activeTypes"
          [smallText]="stats().totalTypes + ' registrados'"
          iconName="bed-double"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="isLoading()"
        />
        <app-stats
          title="Habitaciones activas"
          [value]="stats().activeUnits"
          [smallText]="'de ' + stats().totalUnits + ' registradas'"
          iconName="door-open"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="isLoadingUnits()"
        />
        <app-stats
          title="Listas para vender"
          [value]="stats().sellableUnits"
          smallText="limpias o inspeccionadas"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="isLoadingUnits()"
        />
        <app-stats
          title="Fuera de venta"
          [value]="stats().offSaleUnits"
          smallText="fuera de servicio o bloqueadas"
          iconName="ban"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="isLoadingUnits()"
        />
      </div>

      <!-- Tabs -->
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="activeTab()"
        (tabChange)="onTabChange($event)"
        ariaLabel="Secciones de habitaciones"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              {{ activeTab() === 'types' ? 'Tipos de habitación' : 'Habitaciones' }}
              <span class="text-text-secondary font-normal">
                ({{ activeTab() === 'types' ? rows().length : unitRows().length }})
              </span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                [placeholder]="
                  activeTab() === 'types'
                    ? 'Buscar tipos...'
                    : 'Buscar por número, tipo o zona...'
                "
                [debounceTime]="300"
                [ngModel]="searchTerm()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="activeFilterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="activeTab() === 'types' ? isLoading() : isLoadingUnits()"
                (filterChange)="filterValues.set($event)"
                (clearAllFilters)="filterValues.set({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (activeTab() === 'types') {
            @if (isLoading()) {
              <div class="p-4 md:p-6">
                <app-spinner [center]="true" text="Cargando tipos…" />
              </div>
            } @else if (unitTypes().length === 0) {
              <app-empty-state
                icon="bed-double"
                title="Aún no tienes tipos de habitación"
                description="Crea tipos como Doble, Suite o Cabaña con su capacidad y precio base."
                actionButtonText="Nuevo tipo"
                actionButtonIcon="plus"
                [showActionButton]="canWrite()"
                (actionClick)="openCreate()"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [actions]="actions"
                [cardConfig]="cardConfig"
                [loading]="isLoading()"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay tipos con ese criterio"
                emptyIcon="search"
              />
            }
          } @else {
            @if (isLoadingUnits()) {
              <div class="p-4 md:p-6">
                <app-spinner [center]="true" text="Cargando habitaciones…" />
              </div>
            } @else if (!hasActiveTypes()) {
              <app-empty-state
                icon="bed-double"
                title="Primero crea un tipo de habitación"
                description="Cada habitación pertenece a un tipo (Doble, Suite, Cabaña)."
                actionButtonText="Ir a Tipos"
                [showActionButton]="true"
                (actionClick)="onTabChange('types')"
              />
            } @else if (units().length === 0) {
              <app-empty-state
                icon="door-open"
                title="Aún no tienes habitaciones"
                description="Registra cada habitación física (101, 102, Cabaña 1) con su tipo y piso."
                actionButtonText="Nueva habitación"
                actionButtonIcon="plus"
                [showActionButton]="canWrite()"
                (actionClick)="openCreateUnit()"
              />
            } @else {
              <app-responsive-data-view
                [data]="unitRows()"
                [columns]="unitColumns"
                [actions]="unitActions"
                [cardConfig]="unitCardConfig"
                [loading]="isLoadingUnits()"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay habitaciones con ese criterio"
                emptyIcon="search"
              />
            }
          }
        </div>
      </app-card>

      <app-unit-form-modal
        [isOpen]="isUnitFormOpen()"
        [unit]="editingUnit()"
        [unitTypes]="unitTypes()"
        (isOpenChange)="isUnitFormOpen.set($event)"
        (saved)="reloadAll()"
      />

      <app-unit-type-form-modal
        [isOpen]="isFormOpen()"
        [unitType]="editing()"
        (isOpenChange)="isFormOpen.set($event)"
        (saved)="load()"
      />
    </div>
  `,
})
export class HospitalityRoomsPageComponent implements OnInit {
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly unitsService = inject(LodgingUnitsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);

  /** Housekeeping and front desk only read rooms: no create or edit actions. */
  readonly canWrite = computed(() =>
    this.authFacade.hasPermission('store:lodging:inventory:write'),
  );

  readonly tabs: ScrollableTab[] = [
    { id: 'types', label: 'Tipos', icon: 'bed-double' },
    { id: 'units', label: 'Unidades', icon: 'door-open' },
  ];
  readonly activeTab = signal<RoomsTab>('types');
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly stats = computed(() => {
    const types = this.unitTypes();
    const units = this.units();
    const active = units.filter((u) => u.is_active);
    return {
      totalTypes: types.length,
      activeTypes: types.filter((t) => t.is_active).length,
      totalUnits: units.length,
      activeUnits: active.length,
      sellableUnits: active.filter((u) =>
        SELLABLE_STATUSES.includes(u.housekeeping_status),
      ).length,
      offSaleUnits: active.filter((u) =>
        OFF_SALE_STATUSES.includes(u.housekeeping_status),
      ).length,
    };
  });

  private readonly typeFilterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: ACTIVE_FILTER_OPTIONS,
    },
  ];

  readonly activeFilterConfigs = computed<FilterConfig[]>(() => {
    if (this.activeTab() === 'types') return this.typeFilterConfigs;
    return [
      {
        key: 'unit_type_id',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: '', label: 'Todos los tipos' },
          ...this.unitTypes().map((t) => ({ value: String(t.id), label: t.name })),
        ],
      },
      {
        key: 'housekeeping_status',
        label: 'Estado de limpieza',
        type: 'multi-select',
        options: (Object.keys(HOUSEKEEPING_STATUS_LABELS) as HousekeepingStatus[]).map(
          (k) => ({ value: k, label: HOUSEKEEPING_STATUS_LABELS[k] }),
        ),
        placeholder: 'Todos',
      },
      {
        key: 'is_active',
        label: 'Activa',
        type: 'select',
        options: [
          { value: '', label: 'Todas' },
          { value: 'active', label: 'Activas' },
          { value: 'inactive', label: 'Inactivas' },
        ],
      },
    ];
  });

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    if (!this.canWrite()) return [];
    return this.activeTab() === 'types'
      ? [{ label: 'Nuevo tipo', icon: 'plus', action: 'create-type', variant: 'primary' }]
      : [
          {
            label: 'Nueva habitación',
            icon: 'plus',
            action: 'create-unit',
            variant: 'primary',
            disabled: !this.hasActiveTypes(),
          },
        ];
  });

  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);
  readonly editing = signal<UnitType | null>(null);

  readonly hasActiveTypes = computed(() =>
    this.unitTypes().some((t) => t.is_active),
  );

  readonly units = signal<LodgingUnit[]>([]);
  readonly isLoadingUnits = signal(true);
  readonly isUnitFormOpen = signal(false);
  readonly editingUnit = signal<LodgingUnit | null>(null);

  readonly unitRows = computed<UnitRow[]>(() => {
    const term = this.searchTerm();
    const f = this.filterValues();
    const statuses = Array.isArray(f['housekeeping_status'])
      ? f['housekeeping_status']
      : [];
    return this.units()
      .filter(
        (u) =>
          matches(term, u.code, u.unit_type.name, u.zone, u.floor) &&
          (!f['unit_type_id'] || String(u.unit_type_id) === f['unit_type_id']) &&
          (statuses.length === 0 || statuses.includes(u.housekeeping_status)) &&
          matchesActive(f['is_active'], u.is_active),
      )
      .map((u) => ({
      ...u,
      type_name: u.unit_type.name,
      status: u.is_active ? 'Activa' : 'Inactiva',
    }));
  });

  readonly unitColumns: TableColumn[] = [
    { key: 'code', label: 'Número', sortable: true },
    { key: 'type_name', label: 'Tipo', sortable: true },
    { key: 'floor', label: 'Piso', defaultValue: '—' },
    { key: 'zone', label: 'Zona', defaultValue: '—' },
    {
      key: 'housekeeping_status',
      label: 'Estado',
      badge: true,
      badgeConfig: HOUSEKEEPING_BADGE,
      transform: (v: HousekeepingStatus) => HOUSEKEEPING_STATUS_LABELS[v],
    },
    {
      key: 'is_active',
      label: 'Activa',
      badge: true,
      badgeConfig: ACTIVE_BADGE,
      transform: (v: boolean) => (v ? 'Activa' : 'Inactiva'),
    },
  ];

  readonly unitActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'primary',
      show: () => this.canWrite(),
      action: (item: LodgingUnit) => this.openEditUnit(item),
    },
    {
      label: (item: LodgingUnit) => (item.is_active ? 'Desactivar' : 'Activar'),
      icon: (item: LodgingUnit) => (item.is_active ? 'eye-off' : 'eye'),
      variant: 'secondary',
      show: () => this.canWrite(),
      action: (item: LodgingUnit) => this.toggleUnitActive(item),
    },
  ];

  readonly unitCardConfig: ItemListCardConfig = {
    titleKey: 'code',
    subtitleKey: 'type_name',
    badgeKey: 'housekeeping_status',
    badgeConfig: HOUSEKEEPING_BADGE,
    badgeTransform: (v: HousekeepingStatus) => HOUSEKEEPING_STATUS_LABELS[v],
    detailKeys: [
      { key: 'floor', label: 'Piso', defaultValue: '—' },
      { key: 'zone', label: 'Zona', defaultValue: '—' },
      { key: 'status', label: 'Activa' },
    ],
  };

  readonly rows = computed<UnitTypeRow[]>(() => {
    const term = this.searchTerm();
    const f = this.filterValues();
    return this.unitTypes()
      .filter(
        (u) =>
          matches(term, u.name, u.bed_config) &&
          matchesActive(f['is_active'], u.is_active),
      )
      .map((u) => ({
      ...u,
      capacity: formatCapacity(u),
      units: formatUnitCount(u._count?.units ?? 0),
      // `null` when the user has no price permission (housekeeping).
      price:
        u.product.base_price === null
          ? '—'
          : this.currency.format(u.product.base_price, 0),
      tax:
        u.product.product_tax_assignments
          .map((a) => a.tax_categories.name)
          .join(', ') || 'Sin impuesto',
    }));
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Tipo', sortable: true },
    { key: 'capacity', label: 'Capacidad' },
    { key: 'units', label: 'Habitaciones' },
    { key: 'bed_config', label: 'Camas', defaultValue: '—' },
    { key: 'price', label: 'Precio por noche', align: 'right' },
    { key: 'tax', label: 'Impuesto' },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      badgeConfig: ACTIVE_BADGE,
      transform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'primary',
      show: () => this.canWrite(),
      action: (item: UnitType) => this.openEdit(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'capacity',
    badgeKey: 'is_active',
    badgeConfig: ACTIVE_BADGE,
    badgeTransform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'units', label: 'Habitaciones' },
      { key: 'bed_config', label: 'Camas', defaultValue: '—' },
      { key: 'tax', label: 'Impuesto' },
    ],
    footerKey: 'price',
    footerLabel: 'Precio por noche',
  };

  ngOnInit(): void {
    this.reloadAll();
  }

  onTabChange(tab: string): void {
    this.activeTab.set(tab === 'units' ? 'units' : 'types');
    this.searchTerm.set('');
    this.filterValues.set({});
  }

  onSearch(term: string | null): void {
    this.searchTerm.set(term ?? '');
  }

  onActionClick(action: string): void {
    if (action === 'create-type') this.openCreate();
    else if (action === 'create-unit') this.openCreateUnit();
  }

  /** Units change the per-type count, so both lists reload together. */
  reloadAll(): void {
    this.load();
    this.loadUnits();
  }

  loadUnits(): void {
    this.isLoadingUnits.set(true);
    this.unitsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.units.set(list);
          this.isLoadingUnits.set(false);
        },
        error: (message: unknown) => {
          this.isLoadingUnits.set(false);
          this.toastService.error(
            typeof message === 'string'
              ? message
              : 'No se pudieron cargar las habitaciones',
          );
        },
      });
  }

  openCreateUnit(): void {
    this.editingUnit.set(null);
    this.isUnitFormOpen.set(true);
  }

  openEditUnit(unit: LodgingUnit): void {
    this.editingUnit.set(unit);
    this.isUnitFormOpen.set(true);
  }

  toggleUnitActive(unit: LodgingUnit): void {
    this.unitsService
      .update(unit.id, { is_active: !unit.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            unit.is_active ? 'Habitación desactivada' : 'Habitación activada',
          );
          this.reloadAll();
        },
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string'
              ? message
              : 'No se pudo actualizar la habitación',
          ),
      });
  }

  load(): void {
    this.isLoading.set(true);
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.unitTypes.set(list);
          this.isLoading.set(false);
        },
        error: (message: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof message === 'string'
              ? message
              : 'No se pudieron cargar los tipos de habitación',
          );
        },
      });
  }

  openCreate(): void {
    this.editing.set(null);
    this.isFormOpen.set(true);
  }

  openEdit(unitType: UnitType): void {
    this.editing.set(unitType);
    this.isFormOpen.set(true);
  }
}
