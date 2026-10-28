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
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ToastService,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import { ReservationFormModalComponent } from '../../components/reservation-form-modal/reservation-form-modal.component';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import {
  countNights,
  LodgingReservation,
  LodgingReservationStatus,
  RESERVATION_STATUS_LABELS,
  ReservationStats,
  toDateOnly,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import {
  RESERVATION_STATUS_CHIPS,
  statusBadgeConfig,
} from '../../../shared/hospitality-status';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

interface ReservationRow extends LodgingReservation {
  guest: string;
  room_type: string;
  stay: string;
  nights: string;
  total: string;
}

const PAGE_SIZE = 20;

const STATUS_BADGE = statusBadgeConfig(RESERVATION_STATUS_CHIPS);

/**
 * Hospitality Suite — Reservas. H1.1: create a nightly reservation. H1.2:
 * today's stats, search by guest/number, status and dates, and the detail
 * with history, cancellation and no-show.
 *
 * Standard admin list module: four stats, one card with the sticky search,
 * the options dropdown (create action + status and stay-range filters) and
 * the responsive data view. Search and filters are server-side (paginated).
 */
@Component({
  selector: 'app-hospitality-reservations-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HospitalityLoadErrorComponent,
    SpinnerComponent,
    FormsModule,
    StatsComponent,
    EmptyStateComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    ReservationFormModalComponent,
    ReservationDetailModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Llegadas de hoy"
          [value]="stats() === null && loadError() ? '—' : stats()?.arrivals_today ?? 0"
          smallText="reservas que entran hoy"
          iconName="log-in"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="stats() === null && !loadError()"
        />
        <app-stats
          title="En casa"
          [value]="stats() === null && loadError() ? '—' : stats()?.in_house ?? 0"
          smallText="huéspedes alojados"
          iconName="bed-double"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="stats() === null && !loadError()"
        />
        <app-stats
          title="Ocupación hoy"
          [value]="stats() === null && loadError() ? '—' : (stats()?.occupancy_percent ?? 0) + '%'"
          [smallText]="occupancyText()"
          iconName="gauge"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="stats() === null && !loadError()"
        />
        <app-stats
          title="Libres hoy"
          [value]="stats() === null && loadError() ? '—' : freeTonight()"
          smallText="habitaciones sin ocupar esta noche"
          iconName="door-open"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="stats() === null && !loadError()"
        />
      </div>

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
              Reservas de hotel
              <span class="text-text-secondary font-normal">({{ total() }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar reservas..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="isLoading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loadError() !== null) {
            <app-hospitality-load-error
              what="las reservas"
              [message]="loadError()"
              (retry)="refresh()"
            />
          } @else if (isLoading() && reservations().length === 0) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando reservas…" />
            </div>
          } @else if (reservations().length === 0 && hasFilters()) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ninguna reserva coincide con la búsqueda o los filtros."
              actionButtonText="Limpiar filtros"
              [showActionButton]="true"
              (actionClick)="clearFilters()"
            />
          } @else if (reservations().length === 0 && !hasActiveTypes()) {
            <app-empty-state
              icon="bed-double"
              title="Primero crea tus habitaciones"
              description="Las reservas se hacen sobre los tipos de habitación activos de Hotelería → Habitaciones."
            />
          } @else if (reservations().length === 0) {
            <app-empty-state
              icon="calendar-check"
              title="Aún no tienes reservas"
              description="Crea una reserva por noches para bloquear las habitaciones de esas fechas."
              actionButtonText="Nueva reserva"
              actionButtonIcon="plus"
              [showActionButton]="true"
              (actionClick)="isFormOpen.set(true)"
            />
          } @else {
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="isLoading()"
              [striped]="true"
              [hoverable]="true"
              emptyMessage="No hay reservas con ese criterio"
              emptyIcon="search"
              (rowClick)="openDetail($event)"
            />
            @if (totalPages() > 1) {
              <div class="mt-4 flex justify-center">
                <app-pagination
                  [currentPage]="page()"
                  [total]="total()"
                  [limit]="pageSize"
                  [totalPages]="totalPages()"
                  infoStyle="none"
                  (pageChange)="onPage($event)"
                />
              </div>
            }
          }
        </div>
      </app-card>

      <app-reservation-form-modal
        [isOpen]="isFormOpen()"
        [unitTypes]="unitTypes()"
        (isOpenChange)="isFormOpen.set($event)"
        (saved)="refresh()"
      />
      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="refresh()"
      />
    </div>
  `,
})
export class HospitalityReservationsPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservations = signal<LodgingReservation[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  readonly isFormOpen = signal(false);
  readonly detailId = signal<number | null>(null);
  readonly stats = signal<ReservationStats | null>(null);

  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        ...Object.entries(RESERVATION_STATUS_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
      ],
    },
    { key: 'date_from', label: 'Estadía desde', type: 'date' },
    { key: 'date_to', label: 'Estadía hasta', type: 'date' },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: 'Nueva reserva',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
      disabled: !this.hasActiveTypes(),
    },
  ]);

  private readonly filter = (key: string): string => {
    const value = this.filterValues()[key];
    return typeof value === 'string' ? value : '';
  };

  readonly hasFilters = computed(
    () =>
      !!(
        this.search() ||
        this.filter('status') ||
        this.filter('date_from') ||
        this.filter('date_to')
      ),
  );
  /** Active rooms nobody sleeps in tonight. */
  readonly freeTonight = computed(() => {
    const s = this.stats();
    return s ? Math.max(0, s.active_units - s.occupied_tonight) : 0;
  });
  readonly occupancyText = computed(() => {
    const s = this.stats();
    return s ? `${s.occupied_tonight} de ${s.active_units} habitaciones` : undefined;
  });

  readonly hasActiveTypes = computed(() => this.unitTypes().some((t) => t.is_active));

  readonly rows = computed<ReservationRow[]>(() =>
    this.reservations().map((r) => {
      const arrival = toDateOnly(r.arrival_date);
      const departure = toDateOnly(r.departure_date);
      return {
        ...r,
        guest: [r.customer.first_name, r.customer.last_name].filter(Boolean).join(' '),
        room_type: r.rooms
          .filter((room) => !room.cancelled_at)
          .map((room) => room.unit_type.name)
          .join(', '),
        stay: `${arrival} → ${departure}`,
        nights: String(countNights(arrival, departure)),
        total: this.currency.format(Number(r.total_amount), 0),
      };
    }),
  );

  readonly columns: TableColumn[] = [
    { key: 'reservation_number', label: 'Reserva', sortable: true },
    { key: 'guest', label: 'Huésped' },
    { key: 'room_type', label: 'Tipo' },
    { key: 'stay', label: 'Llegada → Salida' },
    { key: 'nights', label: 'Noches', align: 'center' },
    { key: 'total', label: 'Total', align: 'right' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
        RESERVATION_STATUS_LABELS[value] ?? value,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'reservation_number',
    subtitleKey: 'guest',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
      RESERVATION_STATUS_LABELS[value] ?? value,
    detailKeys: [
      { key: 'room_type', label: 'Tipo' },
      { key: 'stay', label: 'Estadía' },
      { key: 'nights', label: 'Noches' },
    ],
    footerKey: 'total',
    footerLabel: 'Total',
  };

  ngOnInit(): void {
    this.refresh();
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.unitTypes.set(list),
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string'
              ? message
              : 'No se pudieron cargar los tipos de habitación',
          ),
      });
  }

  refresh(): void {
    this.stats.set(null);
    this.loadReservations();
    this.loadStats();
  }

  openDetail(row: ReservationRow): void {
    this.detailId.set(row.id);
  }

  onSearch(term: string | null): void {
    const value = (term ?? '').trim();
    if (value === this.search()) return;
    this.search.set(value);
    this.reloadFirstPage();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.reloadFirstPage();
  }

  clearFilters(): void {
    this.search.set('');
    this.onFilterChange({});
  }

  onActionClick(action: string): void {
    if (action === 'create') this.isFormOpen.set(true);
  }

  onPage(page: number): void {
    this.page.set(page);
    this.loadReservations();
  }

  private reloadFirstPage(): void {
    this.page.set(1);
    this.loadReservations();
  }

  private loadStats(): void {
    this.reservationsService
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => this.stats.set(stats),
        error: (message: string) => this.loadError.set(message),
      });
  }

  loadReservations(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.reservationsService
      .list({
        search: this.search() || undefined,
        status: this.filter('status') as LodgingReservationStatus | '',
        date_from: this.filter('date_from') || undefined,
        date_to: this.filter('date_to') || undefined,
        page: this.page(),
        limit: PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.reservations.set(result.data);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
          this.isLoading.set(false);
        },
        // R-FB-02: a failed load shows the error block, never "Sin resultados".
        error: (message: string) => {
          this.isLoading.set(false);
          this.loadError.set(message);
        },
      });
  }
}
