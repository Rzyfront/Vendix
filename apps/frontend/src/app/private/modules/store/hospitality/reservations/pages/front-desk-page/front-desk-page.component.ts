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
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  IconComponent,
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
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import { ReservationFormModalComponent } from '../../components/reservation-form-modal/reservation-form-modal.component';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import {
  checkInDoneMessage,
  FrontDeskBoard,
  FrontDeskRow,
  LodgingReservation,
  LodgingReservationStatus,
  RESERVATION_STATUS_LABELS,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import {
  RESERVATION_STATUS_CHIPS,
  statusBadgeConfig,
} from '../../../shared/hospitality-status';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

type FrontDeskTab = 'arrivals' | 'departures' | 'in_house';
type DetailStep = 'check_in' | 'check_out' | 'account' | null;

/** R-LIST-08 — "Pérez" matches "perez": lower case without accents. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

interface BoardRow extends FrontDeskRow {
  stay: string;
  guests: string;
  /** "$150.000" when the folio has a pending balance, "Al día" when paid, "—" without folio. */
  balance_label: string;
  /** H8.4 — "2 llaves" the guests still have, "—" with none. */
  keys_label: string;
  /** H8.1 — "✓ 3/3", "Parcial 1/3" or "—" on arrivals. */
  precheckin_label: string;
}

/** H8.4 — keys handed over and not returned: "1 llave", "2 llaves", "—". */
/** H8.1 — online check-in progress of an arrival: "✓ 3/3", "Parcial 1/3" or "—". */
function precheckinLabel(registered: number, expected: number): string {
  if (!registered) return '—';
  return registered >= expected ? `✓ ${registered}/${expected}` : `Parcial ${registered}/${expected}`;
}

function keysLabel(count: number): string {
  if (!count) return '—';
  return count === 1 ? '1 llave' : `${count} llaves`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10-nov`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1]}`;
}

const STATUS_BADGE = statusBadgeConfig(RESERVATION_STATUS_CHIPS);

const statusLabel = (value: LodgingReservationStatus): string =>
  RESERVATION_STATUS_LABELS[value] ?? value;

const TAB_TITLES: Record<FrontDeskTab, string> = {
  arrivals: 'Llegadas',
  departures: 'Salidas',
  in_house: 'En casa',
};

const EMPTY_TEXT: Record<FrontDeskTab, { icon: string; title: string; description: string }> = {
  arrivals: {
    icon: 'log-in',
    title: 'Sin llegadas pendientes',
    description: 'Las reservas confirmadas que llegan hoy aparecen aquí para su check-in.',
  },
  departures: {
    icon: 'log-out',
    title: 'Sin salidas pendientes',
    description: 'Los huéspedes en casa que salen hoy aparecen aquí con el saldo de su cuenta.',
  },
  in_house: {
    icon: 'bed-double',
    title: 'No hay huéspedes en casa',
    description: 'Después del check-in, cada estadía aparece aquí hasta su salida.',
  },
};

/**
 * Hospitality Suite — Recepción (H3.3). Today's arrivals, departures and
 * guests in house of the store business day, each row with its quick action.
 * Check-in runs right here; when it needs the desk (room to pick, holder to
 * register, dirty room to confirm) the reservation detail opens instead.
 *
 * Standard admin list module: four stats, the board tabs, one card with the
 * sticky search, the options dropdown (balance filter + refresh) and the
 * responsive data view. Search and filter run on the loaded board.
 */
@Component({
  selector: 'app-hospitality-front-desk-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HospitalityLoadErrorComponent,
    SpinnerComponent,
    FormsModule,
    StatsComponent,
    CardComponent,
    ScrollableTabsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    ButtonComponent,
    IconComponent,
    ReservationDetailModalComponent,
    ReservationFormModalComponent,
  ],
  // R-ROW-02 — card actions are 44 px touch targets on mobile.
  styles: [
    `
      :host ::ng-deep .footer-actions .footer-action-btn {
        width: 44px;
        height: 44px;
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
          title="Llegadas hoy"
          [value]="loadError() ? '—' : board()?.arrivals?.length ?? 0"
          smallText="reservas por hacer check-in"
          iconName="log-in"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="Salidas hoy"
          [value]="loadError() ? '—' : board()?.departures?.length ?? 0"
          smallText="huéspedes por hacer check-out"
          iconName="log-out"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="En casa"
          [value]="loadError() ? '—' : board()?.in_house?.length ?? 0"
          smallText="estadías alojadas"
          iconName="bed-double"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="Saldo por cobrar"
          [value]="loadError() ? '—' : pendingBalance()"
          [smallText]="loadError() ? '' : pendingBalanceText()"
          iconName="wallet"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="board() === null && !loadError()"
        />
      </div>

      <app-scrollable-tabs
        ariaLabel="Recepción"
        [tabs]="tabs()"
        [activeTab]="tab()"
        (tabChange)="onTab($event)"
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
              {{ tabTitle() }}
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
              @if (businessDate()) {
                <span class="text-text-secondary font-normal"> · {{ businessDate() }}</span>
              }
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por reserva, huésped o habitación…"
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-button
                variant="primary"
                size="md"
                [iconOnlyMobile]="true"
                customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 !rounded-[10px]"
                class="shrink-0"
                ariaLabel="Nueva reserva"
                (clicked)="openForm(false)"
                data-testid="front-desk-new-reservation"
              >
                <app-icon slot="icon" name="plus" [size]="18" />
                Nueva reserva
              </app-button>
              <app-button
                variant="outline"
                size="md"
                [iconOnlyMobile]="true"
                customClasses="!h-11 !w-11 !px-0 md:!w-auto md:!px-4 bg-surface !rounded-[10px]"
                class="shrink-0"
                ariaLabel="Llegada sin reserva"
                (clicked)="openForm(true)"
                data-testid="front-desk-walk-in"
              >
                <app-icon slot="icon" name="user-plus" [size]="18" />
                Llegada sin reserva
              </app-button>
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="board() === null && loadError() === null"
                (filterChange)="filterValues.set($event)"
                (clearAllFilters)="filterValues.set({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loadError() !== null) {
            <app-hospitality-load-error
              what="la recepción"
              [message]="loadError()"
              (retry)="load()"
            />
          } @else if (board() === null) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando recepción…" />
            </div>
          } @else if (rows().length === 0 && hasFilters()) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ninguna estadía coincide con la búsqueda o los filtros."
              actionButtonText="Limpiar filtros"
              [showActionButton]="true"
              (actionClick)="clearFilters()"
            />
          } @else if (rows().length === 0) {
            <app-empty-state
              [icon]="emptyText().icon"
              [title]="emptyText().title"
              [description]="emptyText().description"
              [showActionButton]="false"
            />
          } @else {
            @if (reloading()) {
              <p class="sr-only" role="status">Actualizando recepción…</p>
            }
            <!-- R-FB-04: a reload dims the board instead of emptying it. -->
            <div
              class="transition-opacity"
              [class.opacity-50]="reloading()"
              [attr.aria-busy]="reloading()"
            >
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns()"
                [cardConfig]="cardConfig()"
                [actions]="actions"
                [mobileActions]="actions"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay estadías con ese criterio"
                emptyIcon="search"
                (rowClick)="openDetail($event)"
              />
            </div>
          }
        </div>
      </app-card>

      <app-reservation-form-modal
        [isOpen]="formOpen()"
        [walkIn]="walkIn()"
        [unitTypes]="unitTypes()"
        (isOpenChange)="formOpen.set($event)"
        (saved)="onSaved($event)"
      />
      <app-reservation-detail-modal
        [reservationId]="detailId()"
        [startWith]="detailStep()"
        (closed)="closeDetail()"
        (changed)="load()"
      />
    </div>
  `,
})
export class HospitalityFrontDeskPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly board = signal<FrontDeskBoard | null>(null);
  /** R-FB-04 — a reload of a board already shown. */
  readonly reloading = signal(false);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  readonly tab = signal<FrontDeskTab>('arrivals');
  readonly detailId = signal<number | null>(null);
  /** Step the detail opens on: the check-in room picker or the check-out. */
  readonly detailStep = signal<DetailStep>(null);
  /** U1 — "Nueva reserva" / "Llegada sin reserva" form. */
  readonly formOpen = signal(false);
  readonly walkIn = signal(false);
  readonly unitTypes = signal<UnitType[]>([]);
  /** Reservation whose quick check-in is in flight (blocks a double click). */
  readonly checkingIn = signal<number | null>(null);

  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly businessDate = computed(() => {
    const date = this.board()?.business_date;
    return date ? `Hoy, ${shortDate(date)}` : '';
  });

  readonly tabTitle = computed(() => TAB_TITLES[this.tab()]);

  /** Arrivals have no folio yet: the balance filter only applies after check-in. */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'balance',
      label: 'Saldo de la cuenta',
      type: 'select',
      disabled: this.tab() === 'arrivals',
      options: [
        { value: '', label: 'Todos' },
        { value: 'pending', label: 'Con saldo pendiente' },
        { value: 'paid', label: 'Al día' },
      ],
    },
  ]);

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  private readonly balanceFilter = computed(() => {
    const value = this.filterValues()['balance'];
    return this.tab() !== 'arrivals' && typeof value === 'string' ? value : '';
  });

  readonly hasFilters = computed(() => !!(this.search() || this.balanceFilter()));

  /** Open balance of the stays in house (their folios are the ones still billing). */
  private readonly pendingRows = computed(() =>
    (this.board()?.in_house ?? []).filter((row) => Number(row.balance ?? 0) > 0),
  );

  readonly pendingBalance = computed(() =>
    this.currency.format(
      this.pendingRows().reduce((sum, row) => sum + Number(row.balance), 0),
      0,
    ),
  );

  readonly pendingBalanceText = computed(() => {
    const count = this.pendingRows().length;
    return count === 1 ? '1 cuenta en casa con saldo' : `${count} cuentas en casa con saldo`;
  });

  readonly tabs = computed<ScrollableTab[]>(() => {
    const board = this.board();
    return [
      { id: 'arrivals', label: `Llegadas (${board?.arrivals.length ?? 0})`, icon: 'log-in' },
      { id: 'departures', label: `Salidas (${board?.departures.length ?? 0})`, icon: 'log-out' },
      { id: 'in_house', label: `En casa (${board?.in_house.length ?? 0})`, icon: 'bed-double' },
    ];
  });

  readonly emptyText = computed(() => EMPTY_TEXT[this.tab()]);

  readonly rows = computed<BoardRow[]>(() => {
    const term = normalize(this.search());
    const balance = this.balanceFilter();
    const list = (this.board()?.[this.tab()] ?? []).filter((row) => {
      if (
        term &&
        ![row.reservation_number, row.guest_name, row.rooms].some((value) =>
          normalize(value).includes(term),
        )
      ) {
        return false;
      }
      if (balance === 'pending') return Number(row.balance ?? 0) > 0;
      if (balance === 'paid') return row.balance !== null && Number(row.balance) <= 0;
      return true;
    });
    return list.map((row) => ({
      ...row,
      stay: `${shortDate(row.arrival_date)} → ${shortDate(row.departure_date)}`,
      guests: row.children > 0 ? `${row.adults} + ${row.children} niños` : `${row.adults}`,
      balance_label: this.balanceLabel(row.balance),
      keys_label: keysLabel(row.keys_out),
      precheckin_label: precheckinLabel(row.registered_guests, row.adults + row.children),
    }));
  });

  /** Arrivals have no folio yet: the balance column only shows after check-in. */
  readonly columns = computed<TableColumn[]>(() => {
    const columns: TableColumn[] = [
      { key: 'reservation_number', label: 'Reserva' },
      { key: 'guest_name', label: 'Huésped' },
      { key: 'rooms', label: 'Habitación' },
      { key: 'stay', label: 'Llegada → Salida' },
      { key: 'guests', label: 'Huéspedes', align: 'center' },
    ];
    if (this.tab() === 'arrivals') {
      columns.push({ key: 'precheckin_label', label: 'Pre-registro', align: 'center' });
    } else {
      columns.push({ key: 'keys_label', label: 'Llaves', align: 'center' });
      columns.push({ key: 'balance_label', label: 'Saldo', align: 'right' });
    }
    columns.push({
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: statusLabel,
    });
    return columns;
  });

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'reservation_number',
    subtitleKey: 'guest_name',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: statusLabel,
    detailKeys: [
      { key: 'rooms', label: 'Habitación' },
      { key: 'stay', label: 'Estadía' },
      this.tab() === 'arrivals'
        ? { key: 'precheckin_label', label: 'Pre-registro' }
        : { key: 'keys_label', label: 'Llaves' },
    ],
    ...(this.tab() !== 'arrivals' ? { footerKey: 'balance_label', footerLabel: 'Saldo' } : {}),
  }));

  /**
   * R-ROW-03 — most likely action first: an arrival checks in; a guest in
   * house shows the account, then checks out (from any tab: an early
   * departure leaves from "En casa" too). R-ROW-02: the dark `secondary`
   * icon keeps its contrast; the theme green on its tint does not.
   */
  readonly actions: TableAction[] = [
    {
      label: 'Check-in',
      icon: 'log-in',
      variant: 'secondary',
      show: (row: BoardRow) => row.status === 'confirmed',
      disabled: () => this.checkingIn() !== null,
      action: (row: BoardRow) => this.quickCheckIn(row),
    },
    {
      label: 'Ver cuenta',
      icon: 'receipt',
      variant: 'secondary',
      show: (row: BoardRow) => row.folio_id !== null,
      action: (row: BoardRow) => this.openDetail(row, 'account'),
    },
    {
      // H3.7 — the check-out pays the balance, closes the account and emits the invoice.
      label: 'Check-out',
      icon: 'log-out',
      variant: 'secondary',
      show: (row: BoardRow) => row.status === 'checked_in',
      action: (row: BoardRow) => this.openDetail(row, 'check_out'),
    },
  ];

  ngOnInit(): void {
    this.load();
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.unitTypes.set(list),
        error: () => this.unitTypes.set([]),
      });
  }

  load(): void {
    this.loadError.set(null);
    this.reloading.set(this.board() !== null);
    this.reservationsService
      .frontDesk()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => {
          this.reloading.set(false);
          this.board.set(board);
        },
        // R-FB-02: a failed load shows the error block, never an empty board.
        error: (message: string) => {
          this.reloading.set(false);
          this.board.set(null);
          this.loadError.set(message);
        },
      });
  }

  openForm(walkIn: boolean): void {
    this.walkIn.set(walkIn);
    this.formOpen.set(true);
  }

  /** A walk-in is checked in right away; a booking just refreshes the board. */
  onSaved(reservation: LodgingReservation): void {
    if (!this.walkIn()) {
      this.load();
      return;
    }
    const unassigned = reservation.rooms.filter(
      (room) => !room.cancelled_at && !room.unit,
    ).length;
    this.checkIn(reservation.id, reservation.reservation_number, unassigned);
  }

  onTab(id: string): void {
    this.tab.set(id as FrontDeskTab);
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  clearFilters(): void {
    this.search.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
  }

  openDetail(row: Pick<FrontDeskRow, 'id'>, step: DetailStep = null): void {
    this.detailStep.set(step);
    this.detailId.set(row.id);
  }

  closeDetail(): void {
    this.detailId.set(null);
    this.detailStep.set(null);
  }

  quickCheckIn(row: BoardRow): void {
    this.checkIn(row.id, row.reservation_number, row.unassigned_rooms);
  }

  /**
   * R-CONF-05 — one-click check-in only when every room is assigned. A room
   * still to pick opens the detail on its room picker; a missing holder or a
   * dirty room open the detail too, where H3.2 resolves them.
   */
  private checkIn(id: number, reservationNumber: string, unassignedRooms: number): void {
    if (unassignedRooms > 0) {
      this.load();
      this.openDetail({ id }, 'check_in');
      return;
    }
    this.checkingIn.set(id);
    this.reservationsService
      .checkIn(id, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ reservation, dirtyWarning }) => {
          this.checkingIn.set(null);
          if (!reservation) {
            // The detail asks to confirm checking in to a dirty room.
            this.toastService.error(dirtyWarning);
            this.openDetail({ id }, 'check_in');
            return;
          }
          this.toastService.success(checkInDoneMessage(reservation));
          this.load();
        },
        error: (message: string) => {
          this.checkingIn.set(null);
          this.toastService.error(message || `No se pudo hacer el check-in de ${reservationNumber}`);
          this.load();
          this.openDetail({ id });
        },
      });
  }

  private balanceLabel(balance: string | null): string {
    if (balance === null) return '—';
    const amount = Number(balance);
    return amount > 0 ? this.currency.format(amount, 0) : 'Al día';
  }
}
