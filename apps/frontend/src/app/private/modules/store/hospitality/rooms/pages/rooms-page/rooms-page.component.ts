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
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { UnitFormModalComponent } from '../../components/unit-form-modal/unit-form-modal.component';
import { UnitTypeFormModalComponent } from '../../components/unit-type-form-modal/unit-type-form-modal.component';
import { UnitType } from '../../interfaces/unit-type.interface';
import {
  HOUSEKEEPING_STATUS_LABELS,
  LodgingUnit,
} from '../../interfaces/unit.interface';
import { LodgingUnitsService } from '../../services/units.service';
import { UnitTypesService } from '../../services/unit-types.service';

interface UnitTypeRow extends UnitType {
  capacity: string;
  units: string;
  price: string;
  tax: string;
  status: string;
}

interface UnitRow extends LodgingUnit {
  type_name: string;
  housekeeping: string;
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

/**
 * Hospitality Suite — Habitaciones. H0.2 adds the "Tipos" tab: room types with
 * capacity, beds and nightly base price. H0.3 adds the "Unidades" tab:
 * physical rooms whose active count shows on each type.
 */
@Component({
  selector: 'app-hospitality-rooms-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    ScrollableTabsComponent,
    ResponsiveDataViewComponent,
    UnitTypeFormModalComponent,
    UnitFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Habitaciones"
        subtitle="Tipos de habitación y habitaciones de tu hotel"
        icon="bed-double"
        variant="glass"
      />

      <div class="p-2 md:p-4">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab()"
          (tabChange)="activeTab.set($event)"
          ariaLabel="Secciones de habitaciones"
        />

        @if (activeTab() === 'types') {
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Tipos de habitación ({{ unitTypes().length }})
              </h2>
              <app-button variant="primary" size="md" (clicked)="openCreate()">
                <app-icon slot="icon" name="plus" [size]="16" />
                Nuevo tipo
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (isLoading()) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando tipos…</p>
              </div>
            } @else if (unitTypes().length === 0) {
              <app-empty-state
                icon="bed-double"
                title="Aún no tienes tipos de habitación"
                description="Crea tipos como Doble, Suite o Cabaña con su capacidad y precio base."
                actionButtonText="Nuevo tipo"
                actionButtonIcon="plus"
                [showActionButton]="true"
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
              />
            }
          </div>
        </app-card>
        } @else {
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Habitaciones ({{ units().length }})
              </h2>
              <app-button
                variant="primary"
                size="md"
                [disabled]="!hasActiveTypes()"
                (clicked)="openCreateUnit()"
              >
                <app-icon slot="icon" name="plus" [size]="16" />
                Nueva
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (isLoadingUnits()) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando habitaciones…</p>
              </div>
            } @else if (!hasActiveTypes()) {
              <app-empty-state
                icon="bed-double"
                title="Primero crea un tipo de habitación"
                description="Cada habitación pertenece a un tipo (Doble, Suite, Cabaña)."
                actionButtonText="Ir a Tipos"
                [showActionButton]="true"
                (actionClick)="activeTab.set('types')"
              />
            } @else if (units().length === 0) {
              <app-empty-state
                icon="door-open"
                title="Aún no tienes habitaciones"
                description="Registra cada habitación física (101, 102, Cabaña 1) con su tipo y piso."
                actionButtonText="Nueva habitación"
                actionButtonIcon="plus"
                [showActionButton]="true"
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
              />
            }
          </div>
        </app-card>
        }
      </div>

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

  readonly tabs: ScrollableTab[] = [
    { id: 'types', label: 'Tipos', icon: 'bed-double' },
    { id: 'units', label: 'Unidades', icon: 'door-open' },
  ];
  readonly activeTab = signal('types');

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

  readonly unitRows = computed<UnitRow[]>(() =>
    this.units().map((u) => ({
      ...u,
      type_name: u.unit_type.name,
      housekeeping: HOUSEKEEPING_STATUS_LABELS[u.housekeeping_status],
      status: u.is_active ? 'Activa' : 'Inactiva',
    })),
  );

  readonly unitColumns: TableColumn[] = [
    { key: 'code', label: 'Número', sortable: true },
    { key: 'type_name', label: 'Tipo', sortable: true },
    { key: 'floor', label: 'Piso', defaultValue: '—' },
    { key: 'zone', label: 'Zona', defaultValue: '—' },
    { key: 'housekeeping', label: 'Estado' },
    { key: 'status', label: 'Activa' },
  ];

  readonly unitActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'primary',
      action: (item: LodgingUnit) => this.openEditUnit(item),
    },
    {
      label: (item: LodgingUnit) => (item.is_active ? 'Desactivar' : 'Activar'),
      icon: (item: LodgingUnit) => (item.is_active ? 'eye-off' : 'eye'),
      variant: 'secondary',
      action: (item: LodgingUnit) => this.toggleUnitActive(item),
    },
  ];

  readonly unitCardConfig: ItemListCardConfig = {
    titleKey: 'code',
    subtitleKey: 'type_name',
    detailKeys: [
      { key: 'floor', label: 'Piso', defaultValue: '—' },
      { key: 'housekeeping', label: 'Estado' },
      { key: 'status', label: 'Activa' },
    ],
  };

  readonly rows = computed<UnitTypeRow[]>(() =>
    this.unitTypes().map((u) => ({
      ...u,
      capacity: formatCapacity(u),
      units: formatUnitCount(u._count?.units ?? 0),
      price: this.currency.format(u.product.base_price, 0),
      tax:
        u.product.product_tax_assignments
          .map((a) => a.tax_categories.name)
          .join(', ') || 'Sin impuesto',
      status: u.is_active ? 'Activo' : 'Inactivo',
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Tipo', sortable: true },
    { key: 'capacity', label: 'Capacidad' },
    { key: 'units', label: 'Habitaciones' },
    { key: 'bed_config', label: 'Camas', defaultValue: '—' },
    { key: 'price', label: 'Precio por noche', align: 'right' },
    { key: 'tax', label: 'Impuesto' },
    { key: 'status', label: 'Estado' },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'primary',
      action: (item: UnitType) => this.openEdit(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'capacity',
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
