import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ScrollableTab,
  ScrollableTabsComponent,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { LodgingUnit } from '../../../rooms/interfaces/unit.interface';
import { LodgingUnitsService } from '../../../rooms/services/units.service';
import {
  checkInDoneMessage,
  countNights,
  LodgingOnlinePayment,
  LodgingReservation,
  LodgingReservationRoom,
  RESERVATION_STATUS_LABELS,
  formatNightBreakdown,
  toDateOnly,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { RESERVATION_STATUS_CHIPS } from '../../../shared/hospitality-status';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import { describePolicy } from '../../../rates/interfaces/rate-plan.interface';
import {
  RoomChangeModalComponent,
  RoomChangeTarget,
} from '../room-change-modal/room-change-modal.component';
import { GuestRegisterComponent } from '../guest-register/guest-register.component';
import { KeyHandoversPanelComponent } from '../key-handovers-panel/key-handovers-panel.component';
import { FolioPanelComponent } from '../folio-panel/folio-panel.component';
import { DepositPanelComponent } from '../deposit-panel/deposit-panel.component';
import { CheckOutModalComponent } from '../check-out-modal/check-out-modal.component';

/** Step a list opens the detail on (U1 check-in/out, U8 cancel). */
export type DetailStartStep = 'check_in' | 'check_out' | 'cancel' | null;

/** `cancel_room` cancels one room of a multi-room reservation (H1.5). */
type PendingAction = 'cancel' | 'no_show' | 'cancel_room' | 'check_in' | null;

const SUCCESS_MESSAGES: Record<Exclude<PendingAction, null | 'check_in'>, string> = {
  cancel: 'Reserva cancelada',
  no_show: 'Reserva marcada como no-show',
  cancel_room: 'Habitación cancelada',
};

/** U2 (R-MOD-04) — the detail's sections. */
type DetailTab = 'summary' | 'account' | 'guests' | 'keys' | 'history';

const DETAIL_TABS: ScrollableTab[] = [
  { id: 'summary', label: 'Resumen', icon: 'file-text' },
  { id: 'account', label: 'Cuenta', icon: 'receipt' },
  { id: 'guests', label: 'Huéspedes', icon: 'users' },
  { id: 'keys', label: 'Llaves', icon: 'key-round' },
  { id: 'history', label: 'Historial', icon: 'history' },
];

/** `2026-10-27` → `27 oct` (R-FORM-11: never raw ISO). */
const shortDate = (date: string) => format(parseISO(date), 'd MMM', { locale: es });

/** H3.2 — a guest never enters a room in these states. */
const BLOCKED_HOUSEKEEPING = ['out_of_order', 'out_of_service'];

/**
 * Hospitality Suite (H1.2) — reservation detail: stay, guests, total and
 * status history, with "Cancelar" (reason required) and "Marcar no-show".
 * Both free the nights for sale. "Mover" (H1.4) changes the room or the
 * dates without dragging (the mobile path of the rack). With several rooms
 * (H1.5) each one can be moved or cancelled alone; the others stay active.
 * H2.4: shows the cancellation policy booked (snapshot) and the penalty
 * before and after cancelling.
 * H3.5: deposit panel (required, received, movements, settlement) and the
 * cancel dialog tells what the deposit covers.
 * H3.1: guest register (holder and companions by room).
 * H3.2: "Check-in" picks the room of each unassigned room, asks to confirm a
 * dirty one and opens the folio ("Folio · Abierto · $0").
 * H3.4: the folio panel shows nights, charges, voids, payments and balance.
 * H3.7: "Check-out" pays the balance, closes the folio and emits the invoice.
 * U2: stay and balance on top, then tabs (Resumen · Cuenta · Huéspedes ·
 * Llaves · Historial); full screen on mobile with the primary action fixed below.
 * H8.4 (D12): "Llaves" logs each key or card handed to a guest and its return.
 * H8.5: the summary shows the private rating the guest gave after check-out.
 */
@Component({
  selector: 'app-reservation-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ModalComponent,
    BadgeComponent,
    ScrollableTabsComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    TextareaComponent,
    SelectorComponent,
    RoomChangeModalComponent,
    GuestRegisterComponent,
    KeyHandoversPanelComponent,
    FolioPanelComponent,
    DepositPanelComponent,
    CheckOutModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="reservationId() !== null"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      [size]="'md'"
      [dialog]="true"
      [fullScreenOnMobile]="true"
      customClasses="md:max-w-2xl"
      [title]="title()"
    >
      @if (statusChip(); as chip) {
        <app-badge slot="header-end" [variant]="chip.variant" data-testid="reservation-status-chip">
          {{ chip.label }}
        </app-badge>
      }
      @if (loading()) {
        <div class="flex justify-center py-8"><app-spinner size="md" text="Cargando reserva…" /></div>
      } @else if (reservation(); as r) {
        <div class="space-y-4 text-sm" data-testid="reservation-detail">
          <!-- U2 (R-MOD-04): balance and stay always above the fold. -->
          <div
            class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background px-3 py-2"
            data-testid="reservation-summary"
          >
            <div class="min-w-0">
              <p class="text-xs text-text-secondary">Estadía</p>
              <p class="font-medium text-text-primary" data-testid="reservation-stay">
                {{ stayLabel().dates }} <span class="whitespace-nowrap">{{ stayLabel().nights }}</span>
              </p>
            </div>
            <div class="text-right">
              <p class="text-xs text-text-secondary">{{ r.folio ? 'Saldo pendiente' : 'Total' }}</p>
              <p
                class="text-base font-semibold"
                [class.text-warning]="r.folio && (due() ?? 0) > 0"
                data-testid="reservation-balance"
              >
                {{ r.folio ? (due() === null ? '…' : money(String(due()))) : total() }}
              </p>
            </div>
          </div>

          @if (pending() === 'cancel') {
            <p
              class="rounded-lg border border-border px-3 py-2 font-medium"
              data-testid="cancellation-quote"
            >
              {{ quoteLabel() }}
            </p>
          }
          @if (pending() === 'check_in') {
            <div class="space-y-3" data-testid="check-in-panel">
              @for (room of unassignedRooms(); track room.id) {
                <app-selector
                  [formControl]="unitControl(room.id)"
                  [label]="'Habitación para ' + room.unit_type.name"
                  placeholder="Selecciona una habitación"
                  [options]="unitOptions(room)"
                />
              }
              @if (dirtyWarning()) {
                <p
                  class="rounded-lg bg-warning/10 px-3 py-2 font-medium text-text-primary"
                  data-testid="check-in-dirty"
                >
                  {{ dirtyWarning() }}
                </p>
              }
            </div>
          }
          @if (pending() && pending() !== 'check_in') {
            <app-textarea
              [formControl]="reasonControl"
              [label]="reasonRequired() ? 'Motivo de la cancelación' : 'Motivo (opcional)'"
              [required]="reasonRequired()"
              [rows]="2"
              placeholder="Ej.: el huésped cambió de planes"
            />
          }

          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="activeTab()"
            size="sm"
            ariaLabel="Secciones de la reserva"
            (tabChange)="activeTab.set($any($event))"
          />

          <!-- Panels stay mounted so the folio keeps the balance fresh. -->
          <div class="space-y-4" [class.hidden]="activeTab() !== 'summary'" data-testid="reservation-tab-summary">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt class="text-text-secondary">Titular</dt>
              <dd class="font-medium text-text-primary">
                {{ guestName() }}
                @if (r.customer.phone || r.customer.email) {
                  <span class="block text-xs font-normal text-text-secondary">
                    {{ r.customer.phone || r.customer.email }}
                  </span>
                }
              </dd>
              <dt class="text-text-secondary">Huéspedes</dt>
              <dd>{{ guests() }}</dd>
              <dt class="text-text-secondary">Total</dt>
              <dd class="font-semibold">{{ total() }}</dd>
              @if (r.notes) {
                <dt class="text-text-secondary">Notas</dt>
                <dd>{{ r.notes }}</dd>
              }
              <dt class="text-text-secondary">Cancelación</dt>
              <dd data-testid="reservation-policy">{{ policySummary() }}</dd>
              @if (r.folio?.order?.order_review; as review) {
                <dt class="text-text-secondary">Calificación del huésped</dt>
                <dd data-testid="reservation-stay-review">
                  <span class="font-medium text-warning" [attr.aria-label]="review.rating + ' de 5 estrellas'">
                    {{ stars(review.rating) }}
                  </span>
                  @if (review.comment) {
                    <span class="block text-xs text-text-secondary">“{{ review.comment }}”</span>
                  }
                </dd>
              }
            </dl>

            @if (penaltyLabel(); as penalty) {
              <p
                class="rounded-lg bg-error/10 px-3 py-2 font-medium text-text-primary"
                data-testid="reservation-penalty"
              >
                {{ penalty }}
              </p>
            }

            <div>
              <p class="mb-2 font-medium text-text-primary">
                {{ r.rooms.length > 1 ? 'Habitaciones (' + activeRooms().length + ')' : 'Habitación' }}
              </p>
              <ul class="divide-y divide-border rounded-lg border border-border">
                @for (room of r.rooms; track room.id) {
                  <li
                    class="flex items-center justify-between gap-2 px-3 py-2"
                    data-testid="reservation-room"
                  >
                    <div [class.opacity-60]="room.cancelled_at">
                      <p class="font-medium" data-testid="reservation-unit">
                        {{ room.unit_type.name }} · {{ room.unit?.code ?? 'Sin asignar' }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        {{ roomGuests(room) }} · {{ money(room.total_amount) }}
                        @if (room.cancelled_at) {
                          · Cancelada
                        }
                      </p>
                      @if (!room.cancelled_at && room.nights?.length) {
                        <p
                          class="text-xs text-text-secondary"
                          data-testid="reservation-night-breakdown"
                        >
                          {{ nightBreakdown(room) }}
                        </p>
                      }
                    </div>
                    @if (!room.cancelled_at && !pending()) {
                      <div class="flex flex-wrap justify-end gap-1">
                        @if (canMove()) {
                          <app-button variant="ghost" size="sm" (clicked)="startMove(room)">
                            <app-icon slot="icon" name="arrow-right-left" [size]="14" />
                            Mover
                          </app-button>
                        }
                        @if (canCancelRoom()) {
                          <app-button variant="ghost" size="sm" (clicked)="startCancelRoom(room.id)">
                            <app-icon slot="icon" name="x-circle" [size]="14" />
                            Cancelar habitación
                          </app-button>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </div>
          </div>

          <div class="space-y-4" [class.hidden]="activeTab() !== 'account'" data-testid="reservation-tab-account">
            @for (payment of r.online_payments ?? []; track payment.id) {
              @if (payment.status === 'completed') {
                <p class="font-medium text-text-primary" data-testid="reservation-online-payment">
                  Pago en línea {{ money(payment.amount) }}
                  @if (Number(payment.applied_amount) > 0) {
                    <span class="font-normal text-text-secondary"> · aplicado {{ money(payment.applied_amount) }}</span>
                  }
                  @if (Number(payment.retained_amount ?? 0) > 0) {
                    <span class="font-normal text-text-secondary"> · retenido {{ money(payment.retained_amount ?? '0') }}</span>
                  }
                  @if ((r.status === 'cancelled' || r.status === 'no_show') && onlineOwed(payment) > 0) {
                    <span class="font-normal text-warning" data-testid="reservation-online-owed">
                      · por devolver {{ money(String(onlineOwed(payment))) }}</span
                    >
                  }
                </p>
              } @else if (payment.status === 'pending') {
                <p class="text-warning" data-testid="reservation-online-payment-pending">
                  Pago en línea pendiente {{ money(payment.amount) }}
                </p>
              }
            }

            <app-deposit-panel
              [reservationId]="r.id"
              [refreshKey]="depositVersion()"
              (changed)="refreshFolio()"
            />

            @if (r.folio) {
              <app-folio-panel
                [reservationId]="r.id"
                [inHouse]="r.status === 'checked_in'"
                [refreshKey]="folioVersion()"
                [holder]="{ id: r.customer.id, name: guestName() }"
                (changed)="onFolioChanged()"
                (dueChange)="due.set($event)"
              />
            } @else {
              <p class="text-xs text-text-secondary">La cuenta del huésped se abre al hacer el check-in.</p>
            }
          </div>

          <div [class.hidden]="activeTab() !== 'guests'" data-testid="reservation-tab-guests">
            <app-guest-register [reservation]="r" />
          </div>

          <div [class.hidden]="activeTab() !== 'keys'" data-testid="reservation-tab-keys">
            <app-key-handovers-panel [reservation]="r" (changed)="changed.emit()" />
          </div>

          <div [class.hidden]="activeTab() !== 'history'" data-testid="reservation-tab-history">
            <ol class="space-y-2 border-l border-border pl-3" data-testid="reservation-history">
              @for (e of r.events ?? []; track e.id) {
                <li>
                  <p class="font-medium">
                    {{ e.from_status === e.to_status ? 'Cambio' : labelOf(e.to_status) }}
                  </p>
                  <p class="text-xs text-text-secondary">
                    {{ e.created_at | date: 'dd/MM/yyyy HH:mm' }} ·
                    {{ e.user ? e.user.first_name + ' ' + (e.user.last_name ?? '') : 'Automático' }}
                  </p>
                  @if (e.reason) {
                    <p class="text-xs text-text-secondary">
                      {{ e.from_status === e.to_status ? e.reason : 'Motivo: ' + e.reason }}
                    </p>
                  }
                </li>
              } @empty {
                <li class="text-xs text-text-secondary">
                  Creada {{ r.created_at | date: 'dd/MM/yyyy HH:mm' }}
                </li>
              }
            </ol>
          </div>
        </div>
      }

      <!-- U2 (R-MOD-02, R-CTA-09): secondary left, one primary right; on
           mobile the primary sits on top at full width, fixed at the bottom. -->
      <div
        slot="footer"
        class="flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:items-center sm:justify-between"
      >
        @if (pending()) {
          <app-button variant="outline" customClasses="w-full min-h-11 sm:w-auto sm:min-h-0" (clicked)="pending.set(null)">Volver</app-button>
          @if (pending() === 'check_in') {
            <app-button
              variant="primary"
              class="w-full sm:w-auto" customClasses="w-full min-h-12 sm:min-h-0"
              [loading]="saving()"
              [disabled]="!checkInReady()"
              (clicked)="confirmCheckIn()"
            >
              {{ dirtyWarning() ? 'Check-in de todos modos' : 'Confirmar check-in' }}
            </app-button>
          } @else {
            <app-button
              variant="danger"
              class="w-full sm:w-auto" customClasses="w-full min-h-12 sm:min-h-0"
              [loading]="saving()"
              [disabled]="reasonRequired() && !reasonControl.value.trim()"
              (clicked)="confirmAction()"
            >
              {{ confirmLabel() }}
            </app-button>
          }
        } @else {
          <div class="flex flex-wrap gap-2">
            <app-button variant="outline" customClasses="min-h-11 sm:min-h-0" (clicked)="close()" data-testid="reservation-close">Cerrar</app-button>
            @if (canNoShow()) {
              <app-button variant="ghost" customClasses="min-h-11 sm:min-h-0" (clicked)="startAction('no_show')">
                <app-icon slot="icon" name="user-x" [size]="16" />
                Marcar no-show
              </app-button>
            }
            @if (canCancel()) {
              <app-button variant="ghost" customClasses="min-h-11 sm:min-h-0" (clicked)="startAction('cancel')">
                <app-icon slot="icon" name="x-circle" [size]="16" />
                Cancelar reserva
              </app-button>
            }
          </div>
          @if (reservation()?.status === 'checked_in') {
            <app-button
              variant="primary"
              class="w-full sm:w-auto" customClasses="w-full min-h-12 sm:min-h-0"
              (clicked)="checkOutOpen.set(true)"
              data-testid="reservation-check-out"
            >
              <app-icon slot="icon" name="log-out" [size]="16" />
              Check-out
            </app-button>
          } @else if (canCheckIn()) {
            <app-button
              variant="primary"
              class="w-full sm:w-auto" customClasses="w-full min-h-12 sm:min-h-0"
              (clicked)="startCheckIn()"
              data-testid="reservation-check-in"
            >
              <app-icon slot="icon" name="log-in" [size]="16" />
              Check-in
            </app-button>
          }
        }
      </div>
    </app-modal>

    <app-check-out-modal
      [reservation]="checkOutOpen() ? reservation() : null"
      (closed)="checkOutOpen.set(false)"
      (checkedOut)="onCheckedOut()"
    />

    <app-room-change-modal
      [target]="moveTarget()"
      (closed)="moveTarget.set(null)"
      (changed)="onRoomChanged($event)"
    />
  `,
})
export class ReservationDetailModalComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly unitsService = inject(LodgingUnitsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  /** Reservation to show; `null` keeps the modal closed. */
  readonly reservationId = input<number | null>(null);
  /**
   * U1 — step to open once loaded: the check-in room picker or the
   * check-out, when the reservation's status allows it. U8: `cancel` opens
   * the cancellation (penalty, reason and confirm) from a list row.
   */
  readonly startWith = input<DetailStartStep>(null);
  readonly closed = output<void>();
  /** Emitted after a status change, so the list and stats refresh. */
  readonly changed = output<void>();

  readonly reservation = signal<LodgingReservation | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly pending = signal<PendingAction>(null);
  /** Room picked for `cancel_room`. */
  readonly pendingRoomId = signal<number | null>(null);
  readonly moveTarget = signal<RoomChangeTarget | null>(null);
  /** H8.5 — the guest's 1-5 rating as stars ("★★★★☆"). */
  stars(rating: number): string {
    const full = Math.max(0, Math.min(5, Math.round(rating)));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  /** H3.5 — bumped to make the deposit and folio panels re-fetch each other. */
  readonly depositVersion = signal(0);
  readonly folioVersion = signal(0);

  refreshFolio(): void {
    this.folioVersion.update((v) => v + 1);
  }

  /** H3.7 — the check-out modal is open over the detail. */
  readonly checkOutOpen = signal(false);

  /** H3.7 — the reservation left: reload it (Salida, folio Cerrado). */
  onCheckedOut(): void {
    const id = this.reservationId();
    this.refreshFolio();
    this.changed.emit();
    if (id === null) return;
    // Silent reload: `load` empties the detail and would close the result.
    this.reservationsService
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (reservation) => this.reservation.set(reservation) });
  }

  refreshDeposit(): void {
    this.depositVersion.update((v) => v + 1);
  }
  /** U3 (R-FB-05) — a folio action refreshes the deposit and the list behind the detail. */
  onFolioChanged(): void {
    this.refreshDeposit();
    this.changed.emit();
  }
  /** H2.4 — "Penalidad: $250.000 (1 noche)" of cancelling now. */
  readonly quoteLabel = signal<string>('Calculando penalidad…');
  /** H3.2 — physical rooms to pick at check-in, and the room picked per reservation room. */
  readonly units = signal<LodgingUnit[]>([]);
  private readonly unitControls = signal(new Map<number, FormControl<number | null>>());
  /** Bumped on each pick so `checkInReady` re-reads the controls. */
  private readonly picks = signal(0);
  /** "La 101 está sucia. ¿Hacer check-in de todos modos?" once the server asked. */
  readonly dirtyWarning = signal('');
  readonly reasonControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(500)],
  });

  readonly arrival = computed(() => toDateOnly(this.reservation()?.arrival_date ?? ''));
  readonly departure = computed(() => toDateOnly(this.reservation()?.departure_date ?? ''));
  readonly nights = computed(() => countNights(this.arrival(), this.departure()));
  /** Rooms still sold (a room cancelled alone keeps showing as "Cancelada"). */
  readonly activeRooms = computed(
    () => this.reservation()?.rooms.filter((room) => !room.cancelled_at) ?? [],
  );
  readonly canMove = computed(
    () =>
      ['tentative', 'confirmed', 'checked_in'].includes(this.reservation()?.status ?? '') &&
      this.activeRooms().length > 0,
  );
  /** One room alone only while another stays: the last one cancels the reservation. */
  readonly canCancelRoom = computed(() => this.canCancel() && this.activeRooms().length > 1);
  readonly guests = computed(() => {
    const rooms = this.activeRooms();
    const adults = rooms.reduce((sum, room) => sum + room.adults, 0);
    const children = rooms.reduce((sum, room) => sum + room.children, 0);
    return children > 0 ? `${adults} adultos · ${children} niños` : `${adults} adultos`;
  });
  readonly reasonRequired = computed(() => this.pending() !== 'no_show');
  readonly confirmLabel = computed(() => {
    switch (this.pending()) {
      case 'no_show':
        return 'Confirmar no-show';
      case 'cancel_room':
        return 'Cancelar esta habitación';
      default:
        return 'Confirmar cancelación';
    }
  });
  readonly total = computed(() =>
    this.currency.format(Number(this.reservation()?.total_amount ?? 0), 0),
  );
  readonly tabs = DETAIL_TABS;
  readonly activeTab = signal<DetailTab>('summary');
  /** Folio balance still to collect, reported by the folio panel; null until it loads. */
  readonly due = signal<number | null>(null);
  readonly guestName = computed(() => {
    const customer = this.reservation()?.customer;
    return customer ? `${customer.first_name} ${customer.last_name ?? ''}`.trim() : '';
  });
  /** R-MOD-06 — "Reserva H-0024 · Tata Martínez". */
  readonly title = computed(() => {
    const r = this.reservation();
    return r ? `Reserva ${r.reservation_number} · ${this.guestName()}` : 'Reserva';
  });
  readonly statusChip = computed(() => {
    const status = this.reservation()?.status;
    return status ? RESERVATION_STATUS_CHIPS[status] : null;
  });
  /** "27 oct → 29 oct (2 noches)". */
  readonly stayLabel = computed(() => {
    if (!this.arrival() || !this.departure()) return { dates: '', nights: '' };
    const nights = this.nights();
    return {
      dates: `${shortDate(this.arrival())} → ${shortDate(this.departure())}`,
      nights: `(${nights} ${nights === 1 ? 'noche' : 'noches'})`,
    };
  });
  readonly canCancel = computed(() =>
    ['tentative', 'confirmed'].includes(this.reservation()?.status ?? ''),
  );
  /** H2.4 — policies booked (one per distinct snapshot of the active rooms). */
  readonly policySummary = computed(() => {
    const snapshots = new Map<number, string>();
    for (const room of this.activeRooms()) {
      const policy = room.cancellation_policy_snapshot;
      if (policy) snapshots.set(policy.id, `${policy.name}: ${describePolicy(policy)}`);
    }
    return snapshots.size ? [...snapshots.values()].join(' / ') : 'Sin política: cancelación gratis';
  });
  /** H2.4 — penalty kept when it was cancelled or marked no-show. */
  readonly penaltyLabel = computed(() => {
    const r = this.reservation();
    if (!r?.cancellation_penalty_amount) return '';
    return this.formatPenalty(r.cancellation_penalty_amount, r.cancellation_penalty_detail ?? null);
  });
  /** H3.2 — the server rejects an early arrival with its reason. */
  readonly canCheckIn = computed(() => this.reservation()?.status === 'confirmed');
  readonly unassignedRooms = computed(() => this.activeRooms().filter((room) => !room.unit));
  readonly checkInReady = computed(() => {
    this.picks();
    const controls = this.unitControls();
    return this.unassignedRooms().every((room) => controls.get(room.id)?.value != null);
  });
  readonly canNoShow = computed(
    () => this.reservation()?.status === 'confirmed' && this.arrival() <= storeToday(this.settingsFacade.timezone()),
  );

  constructor() {
    // Load each time a reservation is opened.
    effect(() => {
      const id = this.reservationId();
      if (id !== null) untracked(() => {
        this.activeTab.set('summary');
        this.load(id, this.startWith());
      });
    });
  }

  protected readonly Number = Number;
  protected readonly String = String;

  /** H6.6 — open part of a web payment: not applied to the folio nor kept as penalty. */
  onlineOwed(payment: LodgingOnlinePayment): number {
    return Math.max(
      0,
      Number(payment.amount) - Number(payment.applied_amount) - Number(payment.retained_amount ?? 0),
    );
  }

  money(amount: string): string {
    return this.currency.format(Number(amount), 0);
  }

  /** H2.1 — "Con desayuno · jue $250.000 · vie $320.000 = $570.000". */
  nightBreakdown(room: LodgingReservationRoom): string {
    const nights = formatNightBreakdown(room.nights ?? [], (amount) =>
      this.currency.format(amount, 0),
    );
    return `${room.rate_plan?.name ?? 'Precio base'} · ${nights}`;
  }

  roomGuests(room: LodgingReservationRoom): string {
    const adults = `${room.adults} ${room.adults === 1 ? 'adulto' : 'adultos'}`;
    if (room.children < 1) return adults;
    return `${adults} · ${room.children} ${room.children === 1 ? 'niño' : 'niños'}`;
  }

  /** Active rooms of the same type; a dirty one says so before picking it. */
  unitOptions(room: LodgingReservationRoom): SelectorOption[] {
    return this.units()
      .filter(
        (u) =>
          u.is_active &&
          u.unit_type_id === room.unit_type_id &&
          !BLOCKED_HOUSEKEEPING.includes(u.housekeeping_status),
      )
      .map((u) => ({
        value: u.id,
        label: u.housekeeping_status === 'dirty' ? `${u.code} · Sucia` : u.code,
      }));
  }

  unitControl(roomId: number): FormControl<number | null> {
    return this.unitControls().get(roomId)!;
  }

  /** H3.2 — opens the check-in step: a room picker for each unassigned room. */
  startCheckIn(): void {
    const controls = new Map<number, FormControl<number | null>>();
    for (const room of this.unassignedRooms()) {
      const control = new FormControl<number | null>(null);
      control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.dirtyWarning.set('');
        this.picks.update((n) => n + 1);
      });
      controls.set(room.id, control);
    }
    this.unitControls.set(controls);
    this.dirtyWarning.set('');
    this.pending.set('check_in');
    if (controls.size > 0 && this.units().length === 0) {
      this.unitsService
        .list()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (units) => this.units.set(units),
          error: () => this.units.set([]),
        });
    }
  }

  confirmCheckIn(): void {
    const reservation = this.reservation();
    if (!reservation || !this.checkInReady()) return;
    const rooms = [...this.unitControls().entries()].map(([room_id, control]) => ({
      room_id,
      unit_id: Number(control.value),
    }));
    this.saving.set(true);
    this.reservationsService
      .checkIn(reservation.id, {
        ...(rooms.length ? { rooms } : {}),
        ...(this.dirtyWarning() ? { confirm_dirty: true } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ reservation: updated, dirtyWarning }) => {
          this.saving.set(false);
          if (!updated) {
            this.dirtyWarning.set(dirtyWarning ?? '');
            return;
          }
          this.pending.set(null);
          this.dirtyWarning.set('');
          this.reservation.set(updated);
          this.toastService.success(checkInDoneMessage(updated));
          this.changed.emit();
        },
        error: (message: string) => {
          this.saving.set(false);
          this.toastService.error(message || 'No se pudo hacer el check-in');
        },
      });
  }

  labelOf(status: keyof typeof RESERVATION_STATUS_LABELS): string {
    return RESERVATION_STATUS_LABELS[status] ?? status;
  }

  /** `step` opens once, on the opening load only (later reloads stay put). */
  load(id: number, step: DetailStartStep = null): void {
    this.loading.set(true);
    this.pending.set(null);
    this.reservation.set(null);
    this.due.set(null);
    this.reservationsService
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation) => {
          this.reservation.set(reservation);
          this.loading.set(false);
          if (step === 'check_in' && this.canCheckIn()) this.startCheckIn();
          if (step === 'check_out' && reservation.status === 'checked_in') {
            this.checkOutOpen.set(true);
          }
          if (step === 'cancel' && this.canCancel()) this.startAction('cancel');
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cargar la reserva',
          );
        },
      });
  }

  startMove(room: LodgingReservationRoom): void {
    const r = this.reservation();
    if (!r) return;
    this.moveTarget.set({
      reservation_room_id: room.id,
      reservation_number: r.reservation_number,
      guest: `${r.customer.first_name} ${r.customer.last_name ?? ''}`.trim(),
      unit_id: room.unit?.id ?? room.unit_id,
      arrival_date: toDateOnly(room.arrival_date ?? r.arrival_date),
      departure_date: toDateOnly(room.departure_date ?? r.departure_date),
    });
  }

  onRoomChanged(updated: LodgingReservation): void {
    this.moveTarget.set(null);
    this.load(updated.id);
    this.changed.emit();
  }

  startAction(action: Exclude<PendingAction, null>): void {
    this.reasonControl.setValue('');
    this.pendingRoomId.set(null);
    this.pending.set(action);
    if (action === 'cancel') this.loadCancellationQuote();
  }

  /** H2.4 — penalty of cancelling now, shown before confirming. */
  private loadCancellationQuote(): void {
    const reservation = this.reservation();
    if (!reservation) return;
    this.quoteLabel.set('Calculando penalidad…');
    this.reservationsService
      .cancellationQuote(reservation.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) => {
          if (!quote.penalty_amount) {
            this.quoteLabel.set('Sin penalidad: la cancelación es gratis');
            return;
          }
          let label = this.formatPenalty(quote.penalty_amount, quote.penalty_detail);
          // H3.5 — what the held deposit covers: "· retenido $X · por cobrar $Y".
          if (Number(quote.deposit_balance) > 0) {
            const money = (value: string | undefined) => this.currency.format(Number(value ?? 0), 0);
            label = `Penalidad ${money(quote.penalty_amount)} · retenido ${money(quote.deposit_retained)}`;
            if (Number(quote.to_collect) > 0) label += ` · por cobrar ${money(quote.to_collect)}`;
            if (Number(quote.to_refund) > 0) label += ` · por devolver ${money(quote.to_refund)}`;
          }
          this.quoteLabel.set(label);
        },
        error: () => this.quoteLabel.set('No se pudo calcular la penalidad'),
      });
  }

  /** "Penalidad: $250.000 (1 noche)". */
  private formatPenalty(amount: string, detail: string | null): string {
    const money = this.currency.format(Number(amount), 0);
    return detail ? `Penalidad: ${money} (${detail})` : `Penalidad: ${money}`;
  }

  startCancelRoom(roomId: number): void {
    this.startAction('cancel_room');
    this.pendingRoomId.set(roomId);
  }

  confirmAction(): void {
    const reservation = this.reservation();
    const action = this.pending();
    if (!reservation || !action || action === 'check_in') return;
    const reason = this.reasonControl.value.trim();
    const roomId = this.pendingRoomId();
    if (action === 'cancel_room' && roomId === null) return;
    const request =
      action === 'cancel_room'
        ? this.reservationsService.cancelRoom(roomId!, reason)
        : action === 'cancel'
          ? this.reservationsService.cancel(reservation.id, reason)
          : this.reservationsService.markNoShow(reservation.id, reason || undefined);
    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.pending.set(null);
        this.reservation.set(updated);
        this.toastService.success(SUCCESS_MESSAGES[action]);
        this.changed.emit();
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo actualizar la reserva',
        );
      },
    });
  }

  close(): void {
    this.pending.set(null);
    this.closed.emit();
  }
}
