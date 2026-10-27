import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { HotelRoomType, HotelBookingService, HotelSearchResult } from '../../services/hotel-booking.service';
import { StoreUiService } from '../../services/store-ui.service';
import { apiMessage, dateFromToday, formatDateOnly } from './hotel-date.util';

/** H6.6 — storefront hotel search: dates + guests → available room types → hold → Wompi. */
@Component({
  selector: 'app-hotel-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  template: `
    <div class="mx-auto max-w-4xl space-y-4 p-4">
      <h1 class="flex items-center gap-2 text-xl font-semibold">
        <app-icon name="hotel" [size]="22" />
        Reservar habitación
      </h1>

      <form class="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 md:grid-cols-5" (submit)="submit($event)">
        <label class="flex flex-col gap-1 text-sm">
          Llegada
          <input
            type="date"
            class="rounded-md border border-border px-2 py-2"
            [min]="today"
            [value]="arrival()"
            (input)="onArrival($any($event.target).value)"
            data-testid="hotel-arrival"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          Salida
          <input
            type="date"
            class="rounded-md border border-border px-2 py-2"
            [min]="arrival()"
            [value]="departure()"
            (input)="departure.set($any($event.target).value)"
            data-testid="hotel-departure"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          Adultos
          <input
            type="number"
            min="1"
            class="rounded-md border border-border px-2 py-2"
            [value]="adults()"
            (input)="adults.set(toInt($any($event.target).value, 1))"
            data-testid="hotel-adults"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          Niños
          <input
            type="number"
            min="0"
            class="rounded-md border border-border px-2 py-2"
            [value]="children()"
            (input)="children.set(toInt($any($event.target).value, 0))"
            data-testid="hotel-children"
          />
        </label>
        <div class="col-span-2 flex items-end md:col-span-1">
          <app-button type="submit" [fullWidth]="true" [loading]="searching()">
            <app-icon slot="icon" name="search" [size]="16" />
            Buscar
          </app-button>
        </div>
      </form>

      @if (errorMessage(); as message) {
        <p class="rounded-lg bg-error/10 px-3 py-2 text-sm" data-testid="hotel-error">{{ message }}</p>
      }

      @if (result(); as r) {
        <p class="text-sm text-text-secondary">
          {{ label(r.arrival_date) }} → {{ label(r.departure_date) }} · {{ r.nights }}
          {{ r.nights === 1 ? 'noche' : 'noches' }} · entrada desde {{ r.check_in_time }} · salida
          hasta {{ r.check_out_time }}
        </p>
        @if (r.room_types.length === 0) {
          <p class="rounded-lg border border-border p-4 text-center text-text-secondary">
            No hay habitaciones para esas fechas.
          </p>
        }
        @for (room of r.room_types; track room.id) {
          <article class="overflow-hidden rounded-lg border border-border md:flex" data-testid="hotel-room-type">
            <div class="flex h-44 items-center justify-center bg-surface-secondary md:h-auto md:w-56 md:shrink-0">
              @if (room.images[0]; as src) {
                <img [src]="src" [alt]="room.name" class="h-full w-full object-cover" loading="lazy" />
              } @else {
                <app-icon name="image" [size]="32" class="text-text-secondary" />
              }
            </div>
            <div class="flex flex-1 flex-col gap-2 p-3">
              <h2 class="font-semibold">{{ room.name }}</h2>
              <p class="text-sm text-text-secondary">
                @if (room.bed_config) {
                  {{ room.bed_config }} ·
                }
                Hasta {{ room.max_occupancy }} personas
              </p>
              @if (room.amenities.length > 0) {
                <ul class="flex flex-wrap gap-1">
                  @for (a of room.amenities; track a.code) {
                    <li class="rounded-full bg-surface-secondary px-2 py-0.5 text-xs">{{ a.label }}</li>
                  }
                </ul>
              }
              <p class="text-xs text-text-secondary">{{ room.cancellation_policy || 'Sin política de cancelación' }}</p>
              <div class="mt-auto flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p class="font-semibold" data-testid="hotel-total">
                    Total {{ r.nights }} {{ r.nights === 1 ? 'noche' : 'noches' }} {{ money(room.total_amount) | currency }}
                  </p>
                  <p class="text-sm text-text-secondary" data-testid="hotel-due-now">
                    Paga ahora {{ money(room.amount_due_now) | currency }}
                    @if (isFullPayment(room)) {
                      (Pago total)
                    } @else {
                      (Pago inicial {{ room.deposit_percent }} %)
                    }
                  </p>
                </div>
                <div class="text-right">
                  @if (!room.bookable && room.unavailable_reason) {
                    <p class="mb-1 text-xs text-warning">{{ room.unavailable_reason }}</p>
                  }
                  <app-button
                    [disabled]="!room.bookable || reservingId() !== null"
                    [loading]="reservingId() === room.id"
                    (clicked)="reserve(room)"
                  >
                    Reservar
                  </app-button>
                </div>
              </div>
            </div>
          </article>
        }
      }
    </div>
  `,
})
export class HotelSearchComponent implements OnInit {
  private readonly service = inject(HotelBookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly storeUi = inject(StoreUiService);
  private readonly auth = inject(AuthFacade);
  private readonly authenticated = toSignal(this.auth.isAuthenticated$, { initialValue: false });

  readonly today = dateFromToday(0);
  readonly arrival = signal(dateFromToday(1));
  readonly departure = signal(dateFromToday(2));
  readonly adults = signal(2);
  readonly children = signal(0);

  readonly result = signal<HotelSearchResult | null>(null);
  readonly searching = signal(false);
  readonly reservingId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    const arrival = q.get('arrival_date');
    const departure = q.get('departure_date');
    if (arrival && departure) {
      this.arrival.set(arrival);
      this.departure.set(departure);
      this.adults.set(this.toInt(q.get('adults'), 2, 1));
      this.children.set(this.toInt(q.get('children'), 0));
      this.runSearch();
    }
  }

  toInt(value: unknown, fallback: number, min = 0): number {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n >= min ? n : fallback;
  }

  money(value: string): number {
    return Number(value) || 0;
  }

  isFullPayment(room: HotelRoomType): boolean {
    return Number(room.amount_due_now) >= Number(room.total_amount);
  }

  onArrival(value: string): void {
    this.arrival.set(value);
    if (this.departure() <= value) {
      const [y, m, d] = value.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      this.departure.set(
        `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
      );
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    if (!this.arrival() || !this.departure() || this.departure() <= this.arrival()) {
      this.errorMessage.set('La salida debe ser posterior a la llegada.');
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        arrival_date: this.arrival(),
        departure_date: this.departure(),
        adults: this.adults(),
        children: this.children(),
      },
    });
    this.runSearch();
  }

  reserve(room: HotelRoomType): void {
    if (!this.authenticated()) {
      this.toast.info('Inicia sesión o regístrate para reservar.');
      this.storeUi.openLoginModal();
      return;
    }
    this.reservingId.set(room.id);
    this.service
      .createHold({
        unit_type_id: room.id,
        arrival_date: this.arrival(),
        departure_date: this.departure(),
        adults: this.adults(),
        children: this.children(),
      })
      .subscribe({
        next: (hold) => {
          window.location.href = hold.checkout_url;
        },
        error: (err) => {
          this.reservingId.set(null);
          this.toast.error(apiMessage(err, 'No se pudo crear la reserva.'));
        },
      });
  }

  /** Date-only label for templates that need it. */
  label(date: string): string {
    return formatDateOnly(date);
  }

  private runSearch(): void {
    this.searching.set(true);
    this.errorMessage.set(null);
    this.service
      .search({
        arrival_date: this.arrival(),
        departure_date: this.departure(),
        adults: this.adults(),
        children: this.children(),
      })
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.searching.set(false);
        },
        error: (err) => {
          this.result.set(null);
          this.searching.set(false);
          this.errorMessage.set(apiMessage(err, 'No se pudo consultar la disponibilidad.'));
        },
      });
  }
}
