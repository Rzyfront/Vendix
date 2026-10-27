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
import { UnitTypeFormModalComponent } from '../../components/unit-type-form-modal/unit-type-form-modal.component';
import { UnitType } from '../../interfaces/unit-type.interface';
import { UnitTypesService } from '../../services/unit-types.service';

interface UnitTypeRow extends UnitType {
  capacity: string;
  price: string;
  tax: string;
  status: string;
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
 * capacity, beds and nightly base price. H0.3 adds the "Unidades" tab.
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
      </div>

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
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs: ScrollableTab[] = [
    { id: 'types', label: 'Tipos', icon: 'bed-double' },
  ];
  readonly activeTab = signal('types');

  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);
  readonly editing = signal<UnitType | null>(null);

  readonly rows = computed<UnitTypeRow[]>(() =>
    this.unitTypes().map((u) => ({
      ...u,
      capacity: formatCapacity(u),
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
      { key: 'bed_config', label: 'Camas', defaultValue: '—' },
      { key: 'tax', label: 'Impuesto' },
    ],
    footerKey: 'price',
    footerLabel: 'Precio por noche',
  };

  ngOnInit(): void {
    this.load();
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
