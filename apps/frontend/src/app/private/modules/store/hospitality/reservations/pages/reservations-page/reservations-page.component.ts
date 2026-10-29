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
import { Router, RouterLink } from '@angular/router';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { catchError, map, of, Subject, switchMap } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import { ReservationFormModalComponent } from '../../components/reservation-form-modal/reservation-form-modal.component';
import {
  DetailStartStep,
  ReservationDetailModalComponent,
} from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import {
  countNights,
  LodgingReservation,
  ReservationListResult,
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

/** U8 (R-MOB-03) — `2026-11-20` → `20 nov`, never the ISO date. */
const shortDate = (date: string) => format(parseISO(date), 'd MMM', { locale: es });

/** One list request; the newest replaces any still in flight (RV3). */
type ListResult =
  | { ok: true; result: ReservationListResult }
  | { ok: false; message: string };

/**
 * Hospitality Suite — Reservas. H1.1: create a nightly reservation. H1.2:
 * today's stats, search by guest/number, status and dates, and the detail
 * with history, cancellation and no-show.
 *
 * Standard admin list module: four stats, one card with the sticky search,
 * the visible "Nueva reserva" button, the filters dropdown (status and stay
 * range) and the responsive data view with "Ver" and "Cancelar" per row.
 * Search and filters are server-side (paginated).
 */
@Component({
  selector: 'app-hospitality-reservations-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    IconComponent,
    RouterLink,
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
  // R-ROW-02 — card actions are 44 px touch targets on mobile.
  // R-MOB-03 — card data in the normal typeface, not the shared monospace.
  styles: [
    `
      :host ::ng-deep .footer-actions .footer-action-btn {
        width: 44px;
        height: 44px;
      }
      :host ::ng-deep app-item-list .detail-value {
        font-family: inherit;
      }
    `,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Llegadas de hoy"
          [value]="stats() === null && statsError() !== null ? '—' : stats()?.arrivals_today ?? 0"
          smallText="reservas que entran hoy"
          iconName="log-in"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="stats() === null && statsError() === null"
        />
        <app-stats
          title="En casa"
          [value]="stats() === null && statsError() !== null ? '—' : stats()?.in_house ?? 0"
          smallText="huéspedes alojados"
          iconName="bed-double"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="stats() === null && statsError() === null"
        />
        <app-stats
          title="Ocupación hoy"
          [value]="stats() === null && statsError() !== null ? '—' : (stats()?.occupancy_percent ?? 0) + '%'"
          [smallText]="occupancyText()"
          iconName="gauge"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="stats() === null && statsError() === null"
        />
        <app-stats
          title="Libres hoy"
          [value]="stats() === null && statsError() !== null ? '—' : freeTonight()"
          smallText="habitaciones sin ocupar esta noche"
          iconName="door-open"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="stats() === null && statsError() === null"
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
              <!-- R-CTA-01/06: visible create button; blocked without room types. -->
              @if (canBook()) {
                <app-button
                  variant="primary"
                  size="md"
                  [iconOnlyMobile]="true"
                  customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 !rounded-[10px]"
                  class="shrink-0"
                  [disabled]="noActiveTypes()"
                  [ariaLabel]="noActiveTypes() ? 'Nueva reserva: primero crea un tipo de habitación' : 'Nueva reserva'"
                  (clicked)="isFormOpen.set(true)"
                  data-testid="reservations-new"
                >
                  <app-icon slot="icon" name="plus" [size]="18" />
                  Nueva reserva
                </app-button>
              }
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [isLoading]="isLoading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
              />
            </div>
          </div>
          @if (noActiveTypes()) {
            <p class="mt-2 text-sm text-text-secondary" data-testid="reservations-needs-types">
              Primero crea un tipo de habitación →
              <a class="font-medium text-primary underline" routerLink="/admin/hospitality/rooms">Ir a Tipos</a>
            </p>
          }
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loadError() !== null || statsError() !== null) {
            <app-hospitality-load-error
              what="las reservas"
              [message]="loadError() ?? statsError()"
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
          } @else if (reservations().length === 0 && noActiveTypes()) {
            <!-- RV4: only once the types loaded, never while they load. -->
            <app-empty-state
              icon="bed-double"
              title="Primero crea un tipo de habitación"
              description="Las reservas se hacen sobre los tipos de habitación activos."
              actionButtonText="Ir a Tipos"
              actionButtonIcon="arrow-right"
              [showActionButton]="true"
              (actionClick)="goToTypes()"
            />
          } @else if (reservations().length === 0) {
            <app-empty-state
              icon="calendar-check"
              title="Aún no tienes reservas"
              description="Crea una reserva por noches para bloquear las habitaciones de esas fechas."
              actionButtonText="Nueva reserva"
              actionButtonIcon="plus"
              [showActionButton]="hasActiveTypes() && canBook()"
              (actionClick)="isFormOpen.set(true)"
            />
          } @else {
            <!-- R-FB-04: a reload dims the previous page instead of emptying it. -->
            <div
              class="transition-opacity"
              [class.opacity-50]="isLoading()"
              [attr.aria-busy]="isLoading()"
            >
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [mobileActions]="actions"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay reservas con ese criterio"
                emptyIcon="search"
                (rowClick)="openDetail($event)"
              />
            </div>
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
        [startWith]="detailStep()"
        (closed)="closeDetail()"
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
  private readonly router = inject(Router);
  private readonly authFacade = inject(AuthFacade);

  /** Creating and cancelling need the reservations write permission (as on the rack). */
  readonly canBook = computed(
    () =>
      this.authFacade.ownerFlag() ||
      this.authFacade.hasPermission('store:lodging:reservations:write'),
  );
  /** RV3 — each list request cancels the one still in flight. */
  private readonly listRequests = new Subject<void>();

  readonly reservations = signal<LodgingReservation[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  /** RV2 — failed stats show "—" and the retry block, never zeros. */
  readonly statsError = signal<string | null>(null);
  readonly isFormOpen = signal(false);
  readonly detailId = signal<number | null>(null);
  readonly detailStep = signal<DetailStartStep>(null);
  readonly stats = signal<ReservationStats | null>(null);
  /** RV4 — null until the room types answer. */
  readonly unitTypesLoaded = signal(false);

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
  /** Known to have no active room type (false while they load). */
  readonly noActiveTypes = computed(() => this.unitTypesLoaded() && !this.hasActiveTypes());

  readonly rows = computed<ReservationRow[]>(() =>
    this.reservations().map((r) => {
      const arrival = toDateOnly(r.arrival_date);
      const departure = toDateOnly(r.departure_date);
      const nights = countNights(arrival, departure);
      return {
        ...r,
        guest: [r.customer.first_name, r.customer.last_name].filter(Boolean).join(' '),
        room_type: r.rooms
          .filter((room) => !room.cancelled_at)
          .map((room) => room.unit_type.name)
          .join(', '),
        stay: `${shortDate(arrival)} → ${shortDate(departure)} · ${nights} ${nights === 1 ? 'noche' : 'noches'}`,
        nights: String(nights),
        total: this.currency.format(Number(r.total_amount), 0),
      };
    }),
  );

  readonly columns: TableColumn[] = [
    { key: 'reservation_number', label: 'Reserva', sortable: true },
    { key: 'guest', label: 'Huésped' },
    { key: 'room_type', label: 'Tipo' },
    { key: 'stay', label: 'Estadía' },
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

  /** R-MOB-03 — guest as title, code below, chip, stay with nights and the total. */
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'guest',
    subtitleKey: 'reservation_number',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
      RESERVATION_STATUS_LABELS[value] ?? value,
    detailKeys: [
      { key: 'stay', label: 'Estadía' },
      { key: 'room_type', label: 'Tipo' },
    ],
    footerKey: 'total',
    footerLabel: 'Total',
  };

  /** RV5 (R-ROW-01) — open the detail, or cancel it with its penalty and reason. */
  readonly actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'secondary',
      action: (row: ReservationRow) => this.openDetail(row),
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      show: (row: ReservationRow) =>
        this.canBook() && (row.status === 'tentative' || row.status === 'confirmed'),
      action: (row: ReservationRow) => this.openDetail(row, 'cancel'),
    },
  ];

  constructor() {
    this.listRequests
      .pipe(
        switchMap(() =>
          this.reservationsService
            .list({
              search: this.search() || undefined,
              status: this.filter('status') as LodgingReservationStatus | '',
              date_from: this.filter('date_from') || undefined,
              date_to: this.filter('date_to') || undefined,
              page: this.page(),
              limit: PAGE_SIZE,
            })
            .pipe(
              map((result): ListResult => ({ ok: true, result })),
              catchError((message: unknown) =>
                of<ListResult>({
                  ok: false,
                  message: typeof message === 'string' ? message : 'Error de conexión',
                }),
              ),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.isLoading.set(false);
        if (!response.ok) {
          // R-FB-02: a failed load shows the error block, never "Sin resultados".
          this.loadError.set(response.message);
          return;
        }
        this.reservations.set(response.result.data);
        this.total.set(response.result.total);
        this.totalPages.set(response.result.totalPages);
      });
  }

  ngOnInit(): void {
    this.refresh();
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.unitTypes.set(list);
          this.unitTypesLoaded.set(true);
        },
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
    this.statsError.set(null);
    this.loadReservations();
    this.loadStats();
  }

  openDetail(row: ReservationRow, step: DetailStartStep = null): void {
    this.detailStep.set(step);
    this.detailId.set(row.id);
  }

  closeDetail(): void {
    this.detailId.set(null);
    this.detailStep.set(null);
  }

  goToTypes(): void {
    this.router.navigateByUrl('/admin/hospitality/rooms');
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
        error: (message: unknown) =>
          this.statsError.set(typeof message === 'string' ? message : 'Error de conexión'),
      });
  }

  loadReservations(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.listRequests.next();
  }
}
