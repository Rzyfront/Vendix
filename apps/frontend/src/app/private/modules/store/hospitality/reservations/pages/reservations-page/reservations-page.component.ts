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
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
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

interface ReservationRow extends LodgingReservation {
  guest: string;
  room_type: string;
  stay: string;
  nights: string;
  total: string;
}

const PAGE_SIZE = 20;

/**
 * Hospitality Suite — Reservas. H1.1: create a nightly reservation. H1.2:
 * today's stats, search by guest/number, status and dates, and the detail
 * with history, cancellation and no-show.
 */
@Component({
  selector: 'app-hospitality-reservations-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    StatsComponent,
    InputComponent,
    InputsearchComponent,
    SelectorComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    ReservationFormModalComponent,
    ReservationDetailModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Reservas"
        subtitle="Reservas por noches de tu hotel"
        icon="calendar-check"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Llegadas de hoy"
          [value]="stats()?.arrivals_today ?? 0"
          iconName="log-in"
          [loading]="stats() === null"
        />
        <app-stats
          title="En casa"
          [value]="stats()?.in_house ?? 0"
          iconName="bed-double"
          [loading]="stats() === null"
        />
        <app-stats
          title="Ocupación de hoy"
          [value]="(stats()?.occupancy_percent ?? 0) + '%'"
          [smallText]="occupancyText()"
          iconName="gauge"
          [loading]="stats() === null"
        />
      </div>

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Reservas ({{ total() }})
              </h2>
              <app-button
                variant="primary"
                size="md"
                [disabled]="!hasActiveTypes()"
                (clicked)="isFormOpen.set(true)"
              >
                <app-icon slot="icon" name="plus" [size]="16" />
                Nueva reserva
              </app-button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 px-2 pt-3 md:grid-cols-4 md:px-6">
            <app-inputsearch
              class="col-span-2 md:col-span-1"
              size="sm"
              placeholder="Buscar huésped o número…"
              (search)="onSearch($event)"
            />
            <app-selector
              class="col-span-2 md:col-span-1"
              size="sm"
              [options]="statusOptions"
              [value]="status()"
              (valueChange)="onStatus($event)"
            />
            <app-input
              type="date"
              size="sm"
              label="Desde"
              customWrapperClass="mt-0"
              (inputChange)="onDate('from', $event)"
            />
            <app-input
              type="date"
              size="sm"
              label="Hasta"
              customWrapperClass="mt-0"
              (inputChange)="onDate('to', $event)"
            />
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (isLoading()) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando reservas…</p>
              </div>
            } @else if (reservations().length === 0 && hasFilters()) {
              <app-empty-state
                icon="search"
                title="Sin resultados"
                description="Ninguna reserva coincide con la búsqueda o los filtros."
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
                (rowClick)="openDetail($event)"
              />
              @if (totalPages() > 1) {
                <app-pagination
                  [currentPage]="page()"
                  [total]="total()"
                  [limit]="pageSize"
                  [totalPages]="totalPages()"
                  infoStyle="none"
                  (pageChange)="onPage($event)"
                />
              }
            }
          </div>
        </app-card>
      </div>

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
  readonly isFormOpen = signal(false);
  readonly detailId = signal<number | null>(null);
  readonly stats = signal<ReservationStats | null>(null);

  readonly search = signal('');
  readonly status = signal<LodgingReservationStatus | ''>('');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly statusOptions: SelectorOption[] = [
    { value: '', label: 'Todos los estados' },
    ...Object.entries(RESERVATION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ];

  readonly hasFilters = computed(
    () => !!(this.search() || this.status() || this.dateFrom() || this.dateTo()),
  );
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
      badgeConfig: { type: 'status' },
      transform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
        RESERVATION_STATUS_LABELS[value] ?? value,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'reservation_number',
    subtitleKey: 'guest',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
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
    this.loadReservations();
    this.loadStats();
  }

  openDetail(row: ReservationRow): void {
    this.detailId.set(row.id);
  }

  onSearch(term: string): void {
    this.search.set(term.trim());
    this.reloadFirstPage();
  }

  onStatus(value: string | number | null): void {
    this.status.set((value || '') as LodgingReservationStatus | '');
    this.reloadFirstPage();
  }

  onDate(which: 'from' | 'to', value: string | number): void {
    (which === 'from' ? this.dateFrom : this.dateTo).set(String(value ?? ''));
    this.reloadFirstPage();
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
      .subscribe({ next: (stats) => this.stats.set(stats), error: () => {} });
  }

  loadReservations(): void {
    this.isLoading.set(true);
    this.reservationsService
      .list({
        search: this.search() || undefined,
        status: this.status(),
        date_from: this.dateFrom() || undefined,
        date_to: this.dateTo() || undefined,
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
        error: (message: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las reservas',
          );
        },
      });
  }
}
