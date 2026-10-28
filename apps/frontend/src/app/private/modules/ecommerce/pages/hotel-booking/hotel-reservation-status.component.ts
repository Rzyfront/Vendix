import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { HotelBookingService, HotelReservation } from '../../services/hotel-booking.service';
import { StoreUiService } from '../../services/store-ui.service';
import { apiMessage, formatDateOnly } from './hotel-date.util';

const POLL_MS = 5000;
const MAX_POLLS = 24; // ~2 minutes

/** H6.6 — return page of the hotel booking: status of the reservation, polled while the payment is pending. */
@Component({
  selector: 'app-hotel-reservation-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent, CurrencyPipe, RouterLink],
  template: `
    <div class="mx-auto max-w-xl space-y-4 p-4">
      <h1 class="flex items-center gap-2 text-xl font-semibold">
        <app-icon name="hotel" [size]="22" />
        Tu reserva
      </h1>

      @if (!authenticated()) {
        <div class="space-y-3 rounded-lg border border-border p-4 text-center">
          <p>Inicia sesión para ver el estado de tu reserva.</p>
          <app-button (clicked)="openLogin()">Iniciar sesión</app-button>
        </div>
      } @else if (errorMessage(); as message) {
        <p class="rounded-lg bg-error/10 px-3 py-2 text-sm" data-testid="hotel-status-error">{{ message }}</p>
      } @else if (reservation(); as r) {
        <div class="space-y-3 rounded-lg border border-border p-4">
          <p class="text-sm text-text-secondary">Reserva {{ r.reservation_number }}</p>
          <p class="text-lg font-semibold" data-testid="hotel-status-label">{{ statusLabel() }}</p>

          @if (r.status === 'tentative') {
            @if (!expired() && holdTime(); as time) {
              <p data-testid="hotel-hold-until">Paga antes de {{ time }}</p>
            }
            @if (polling()) {
              <p class="text-sm text-text-secondary">Esperando la confirmación del pago…</p>
            }
          } @else if (r.status === 'confirmed') {
            <p>Te enviamos la confirmación a tu correo.</p>
          }

          <dl class="grid grid-cols-2 gap-y-1 text-sm">
            <dt class="text-text-secondary">Habitación</dt>
            <dd>{{ r.room_type }}</dd>
            <dt class="text-text-secondary">Llegada</dt>
            <dd>{{ date(r.arrival_date) }}</dd>
            <dt class="text-text-secondary">Salida</dt>
            <dd>{{ date(r.departure_date) }}</dd>
            <dt class="text-text-secondary">Huéspedes</dt>
            <dd>{{ r.adults }} adultos{{ r.children > 0 ? ' · ' + r.children + ' niños' : '' }}</dd>
            <dt class="text-text-secondary">Total</dt>
            <dd>{{ num(r.total_amount) | currency }}</dd>
            <dt class="text-text-secondary">Pagado</dt>
            <dd>{{ num(r.paid_amount) | currency }}</dd>
          </dl>

          @if (r.status === 'tentative') {
            <div class="flex flex-wrap gap-2">
              @if (!expired() && r.checkout_url; as url) {
                <app-button (clicked)="pay(url)">Ir a pagar</app-button>
              }
              <app-button variant="outline" [loading]="loading()" (clicked)="refresh()">
                <app-icon slot="icon" name="refresh-cw" [size]="14" />
                Ya pagué / actualizar
              </app-button>
            </div>
          }
        </div>
      } @else {
        <p class="text-text-secondary">Cargando reserva…</p>
      }

      <a routerLink="/hotel" class="block text-center text-sm underline">Buscar otra habitación</a>
    </div>
  `,
})
export class HotelReservationStatusComponent implements OnInit {
  private readonly service = inject(HotelBookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly storeUi = inject(StoreUiService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly authenticated = toSignal(this.auth.isAuthenticated$, { initialValue: false });
  readonly reservation = signal<HotelReservation | null>(null);
  readonly loading = signal(false);
  readonly polling = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private id = 0;
  private polls = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly expired = computed(() => {
    const until = this.reservation()?.hold_expires_at;
    return !!until && Date.parse(until) <= Date.now();
  });

  readonly holdTime = computed(() => {
    const until = this.reservation()?.hold_expires_at;
    return until
      ? new Date(until).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      : null;
  });

  readonly statusLabel = computed(() => {
    const r = this.reservation();
    if (!r) return '';
    switch (r.status) {
      case 'tentative':
        return this.expired() ? 'La reserva venció sin pago' : 'Pendiente de pago';
      case 'confirmed':
        return 'Confirmada';
      case 'checked_in':
        return 'En alojamiento';
      case 'checked_out':
        return 'Finalizada';
      case 'no_show':
        return 'No se presentó';
      default:
        // A released web hold cancels its unpaid online payment.
        return r.payment_status === 'cancelled' ? 'La reserva venció sin pago' : 'Cancelada';
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
    // Loads (and starts polling) once the customer is logged in.
    effect(() => {
      if (this.authenticated() && this.id && !this.reservation()) this.load();
    });
  }

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    if (!this.id) this.errorMessage.set('Reserva no encontrada.');
  }

  openLogin(): void {
    this.storeUi.openLoginModal();
  }

  pay(url: string): void {
    window.location.href = url;
  }

  refresh(): void {
    this.polls = 0;
    this.load();
  }

  date(value: string): string {
    return formatDateOnly(value);
  }

  num(value: string): number {
    return Number(value) || 0;
  }

  private load(): void {
    this.stopPolling();
    this.loading.set(true);
    this.service.getReservation(this.id).subscribe({
      next: (reservation) => {
        this.reservation.set(reservation);
        this.errorMessage.set(null);
        this.loading.set(false);
        this.schedulePoll(reservation);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(apiMessage(err, 'No se pudo cargar la reserva.'));
      },
    });
  }

  private schedulePoll(reservation: HotelReservation): void {
    const pending = reservation.status === 'tentative' && !this.expired();
    if (!pending || this.polls >= MAX_POLLS) {
      this.polling.set(false);
      return;
    }
    this.polling.set(true);
    this.timer = setTimeout(() => {
      this.polls++;
      this.load();
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
