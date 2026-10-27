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
  CardComponent,
  EmptyStateComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ParsedApiError } from '../../../../../../../core/utils/parse-api-error';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import { FrontDeskBoard, FrontDeskRow } from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

type FrontDeskTab = 'arrivals' | 'departures' | 'in_house';

interface BoardRow extends FrontDeskRow {
  stay: string;
  guests: string;
  /** "$150.000" when the folio has a pending balance, "Al día" when paid, "—" without folio. */
  balance_label: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10-nov`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1]}`;
}

const EMPTY_TEXT: Record<FrontDeskTab, { icon: string; title: string; description: string }> = {
  arrivals: {
    icon: 'log-in',
    title: 'Sin llegadas pendientes',
    description: 'Las reservas confirmadas que llegan hoy aparecen aquí para su check-in.',
  },
  departures: {
    icon: 'log-out',
    title: 'Sin salidas pendientes',
    description: 'Los huéspedes en casa que salen hoy aparecen aquí con el saldo de su folio.',
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
 */
@Component({
  selector: 'app-hospitality-front-desk-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    ScrollableTabsComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    SpinnerComponent,
    ReservationDetailModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Recepción"
        [subtitle]="subtitle()"
        icon="concierge-bell"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Llegadas"
          [value]="board()?.arrivals?.length ?? 0"
          iconName="log-in"
          [loading]="board() === null"
        />
        <app-stats
          title="Salidas"
          [value]="board()?.departures?.length ?? 0"
          iconName="log-out"
          [loading]="board() === null"
        />
        <app-stats
          title="En casa"
          [value]="board()?.in_house?.length ?? 0"
          iconName="bed-double"
          [loading]="board() === null"
        />
      </div>

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 pt-2 md:px-6 md:pt-4">
            <app-scrollable-tabs
              ariaLabel="Recepción"
              [tabs]="tabs()"
              [activeTab]="tab()"
              (tabChange)="onTab($event)"
            />
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (board() === null) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando recepción…</p>
              </div>
            } @else if (rows().length === 0) {
              <app-empty-state
                [icon]="emptyText().icon"
                [title]="emptyText().title"
                [description]="emptyText().description"
                [showActionButton]="false"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns()"
                [cardConfig]="cardConfig()"
                [actions]="actions"
                [mobileActions]="actions"
                [striped]="true"
                [hoverable]="true"
                (rowClick)="openDetail($event)"
              />
            }
          </div>
        </app-card>
      </div>

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="load()"
      />
    </div>
  `,
})
export class HospitalityFrontDeskPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly board = signal<FrontDeskBoard | null>(null);
  readonly tab = signal<FrontDeskTab>('arrivals');
  readonly detailId = signal<number | null>(null);
  /** Reservation whose quick check-in is in flight (blocks a double click). */
  readonly checkingIn = signal<number | null>(null);

  readonly subtitle = computed(() => {
    const date = this.board()?.business_date;
    return date ? `Hoy, ${shortDate(date)}` : 'Llegadas, salidas y huéspedes en casa';
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
    const list = this.board()?.[this.tab()] ?? [];
    return list.map((row) => ({
      ...row,
      stay: `${shortDate(row.arrival_date)} → ${shortDate(row.departure_date)}`,
      guests: row.children > 0 ? `${row.adults} + ${row.children} niños` : `${row.adults}`,
      balance_label: this.balanceLabel(row.balance),
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
    if (this.tab() !== 'arrivals') {
      columns.push({ key: 'balance_label', label: 'Saldo', align: 'right' });
    }
    return columns;
  });

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'reservation_number',
    subtitleKey: 'guest_name',
    detailKeys: [
      { key: 'rooms', label: 'Habitación' },
      { key: 'stay', label: 'Estadía' },
    ],
    ...(this.tab() !== 'arrivals' ? { footerKey: 'balance_label', footerLabel: 'Saldo' } : {}),
  }));

  readonly actions: TableAction[] = [
    {
      label: 'Check-in',
      icon: 'log-in',
      variant: 'primary',
      show: (row: BoardRow) => row.status === 'confirmed',
      disabled: () => this.checkingIn() !== null,
      action: (row: BoardRow) => this.quickCheckIn(row),
    },
    {
      // H3.7 — opens the reservation detail, whose "Check-out" pays the
      // balance, closes the folio and emits the invoice.
      label: 'Check-out',
      icon: 'log-out',
      variant: 'secondary',
      show: (row: BoardRow) =>
        row.status === 'checked_in' && this.tab() === 'departures',
      action: (row: BoardRow) => this.openDetail(row),
    },
    {
      label: 'Ver folio',
      icon: 'receipt',
      variant: 'ghost',
      show: (row: BoardRow) => row.folio_id !== null,
      action: (row: BoardRow) => this.openDetail(row),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.reservationsService
      .frontDesk()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => this.board.set(board),
        error: (message: unknown) => {
          this.board.set({ business_date: '', arrivals: [], departures: [], in_house: [] });
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cargar la recepción',
          );
        },
      });
  }

  onTab(id: string): void {
    this.tab.set(id as FrontDeskTab);
  }

  openDetail(row: FrontDeskRow): void {
    this.detailId.set(row.id);
  }

  /**
   * One-click check-in when the reservation is ready. A room still to pick,
   * a missing holder or a dirty room open the detail, where H3.2 resolves
   * them.
   */
  quickCheckIn(row: BoardRow): void {
    if (row.rooms.includes('Sin asignar')) {
      this.openDetail(row);
      return;
    }
    this.checkingIn.set(row.id);
    this.reservationsService
      .checkIn(row.id, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.checkingIn.set(null);
          this.toastService.success(`Check-in de ${row.reservation_number} realizado`);
          this.load();
        },
        error: (error: ParsedApiError) => {
          this.checkingIn.set(null);
          this.toastService.error(error.userMessage);
          this.openDetail(row);
        },
      });
  }

  private balanceLabel(balance: string | null): string {
    if (balance === null) return '—';
    const amount = Number(balance);
    return amount > 0 ? this.currency.format(amount, 0) : 'Al día';
  }
}
