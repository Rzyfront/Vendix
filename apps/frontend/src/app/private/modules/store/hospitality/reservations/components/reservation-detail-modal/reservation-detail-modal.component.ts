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
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  countNights,
  LodgingReservation,
  LodgingReservationRoom,
  RESERVATION_STATUS_LABELS,
  toDateOnly,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import {
  RoomChangeModalComponent,
  RoomChangeTarget,
} from '../room-change-modal/room-change-modal.component';

/** `cancel_room` cancels one room of a multi-room reservation (H1.5). */
type PendingAction = 'cancel' | 'no_show' | 'cancel_room' | null;

const SUCCESS_MESSAGES: Record<Exclude<PendingAction, null>, string> = {
  cancel: 'Reserva cancelada',
  no_show: 'Reserva marcada como no-show',
  cancel_room: 'Habitación cancelada',
};

/** Local civil date `YYYY-MM-DD` of the browser (the desk's day). */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Hospitality Suite (H1.2) — reservation detail: stay, guests, total and
 * status history, with "Cancelar" (reason required) and "Marcar no-show".
 * Both free the nights for sale. "Mover" (H1.4) changes the room or the
 * dates without dragging (the mobile path of the rack). With several rooms
 * (H1.5) each one can be moved or cancelled alone; the others stay active.
 */
@Component({
  selector: 'app-reservation-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    TextareaComponent,
    RoomChangeModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="reservationId() !== null"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      [size]="'md'"
      [dialog]="true"
      [title]="reservation()?.reservation_number ?? 'Reserva'"
      [subtitle]="statusLabel()"
    >
      @if (loading()) {
        <div class="flex justify-center py-8"><app-spinner size="md" /></div>
      } @else if (reservation(); as r) {
        <div class="space-y-4 text-sm" data-testid="reservation-detail">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt class="text-text-secondary">Huésped</dt>
            <dd class="font-medium text-text-primary">
              {{ r.customer.first_name }} {{ r.customer.last_name ?? '' }}
              @if (r.customer.phone || r.customer.email) {
                <span class="block text-xs font-normal text-text-secondary">
                  {{ r.customer.phone || r.customer.email }}
                </span>
              }
            </dd>
            <dt class="text-text-secondary">Llegada → Salida</dt>
            <dd>{{ arrival() }} → {{ departure() }}</dd>
            <dt class="text-text-secondary">Noches</dt>
            <dd>{{ nights() }}</dd>
            <dt class="text-text-secondary">Huéspedes</dt>
            <dd>{{ guests() }}</dd>
            <dt class="text-text-secondary">Total</dt>
            <dd class="font-semibold">{{ total() }}</dd>
            @if (r.notes) {
              <dt class="text-text-secondary">Notas</dt>
              <dd>{{ r.notes }}</dd>
            }
          </dl>

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

          <div>
            <p class="mb-2 font-medium text-text-primary">Historial</p>
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

          @if (pending()) {
            <app-textarea
              [formControl]="reasonControl"
              [label]="reasonRequired() ? 'Motivo de la cancelación' : 'Motivo (opcional)'"
              [required]="reasonRequired()"
              [rows]="2"
              placeholder="Ej.: el huésped cambió de planes"
            />
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        @if (pending()) {
          <app-button variant="ghost" (clicked)="pending.set(null)">Volver</app-button>
          <app-button
            variant="danger"
            [loading]="saving()"
            [disabled]="reasonRequired() && !reasonControl.value.trim()"
            (clicked)="confirmAction()"
          >
            {{ confirmLabel() }}
          </app-button>
        } @else {
          @if (canNoShow()) {
            <app-button variant="outline" (clicked)="startAction('no_show')">
              <app-icon slot="icon" name="user-x" [size]="16" />
              Marcar no-show
            </app-button>
          }
          @if (canCancel()) {
            <app-button variant="danger" (clicked)="startAction('cancel')">
              <app-icon slot="icon" name="x-circle" [size]="16" />
              Cancelar
            </app-button>
          }
          <app-button variant="ghost" (clicked)="close()">Cerrar</app-button>
        }
      </div>
    </app-modal>

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
  private readonly destroyRef = inject(DestroyRef);

  /** Reservation to show; `null` keeps the modal closed. */
  readonly reservationId = input<number | null>(null);
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
  readonly statusLabel = computed(() => {
    const status = this.reservation()?.status;
    return status ? RESERVATION_STATUS_LABELS[status] : '';
  });
  readonly canCancel = computed(() =>
    ['tentative', 'confirmed'].includes(this.reservation()?.status ?? ''),
  );
  readonly canNoShow = computed(
    () => this.reservation()?.status === 'confirmed' && this.arrival() <= todayLocal(),
  );

  constructor() {
    // Load each time a reservation is opened.
    effect(() => {
      const id = this.reservationId();
      if (id !== null) untracked(() => this.load(id));
    });
  }

  money(amount: string): string {
    return this.currency.format(Number(amount), 0);
  }

  roomGuests(room: LodgingReservationRoom): string {
    const adults = `${room.adults} ${room.adults === 1 ? 'adulto' : 'adultos'}`;
    if (room.children < 1) return adults;
    return `${adults} · ${room.children} ${room.children === 1 ? 'niño' : 'niños'}`;
  }

  labelOf(status: keyof typeof RESERVATION_STATUS_LABELS): string {
    return RESERVATION_STATUS_LABELS[status] ?? status;
  }

  load(id: number): void {
    this.loading.set(true);
    this.pending.set(null);
    this.reservation.set(null);
    this.reservationsService
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation) => {
          this.reservation.set(reservation);
          this.loading.set(false);
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
  }

  startCancelRoom(roomId: number): void {
    this.startAction('cancel_room');
    this.pendingRoomId.set(roomId);
  }

  confirmAction(): void {
    const reservation = this.reservation();
    const action = this.pending();
    if (!reservation || !action) return;
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
