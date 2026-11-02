import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { HotelReservationStatusComponent } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-reservation-status.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BookingPageService, OnlineCheckin } from './booking-page.service';
import { checkinMessage } from './booking-page.util';

const POLL_MS = 5000;
const MAX_POLLS = 24; // ~2 minutes, same as the reservation status

/**
 * `/hotel/reserva/:id` of the booking domain — the payment return page.
 * Above, the PMS reservation status of the ecommerce (unchanged: it polls
 * while the payment confirms). Below, the online check-in of the PMS (H8.1)
 * for the guest who booked: open once the reservation is confirmed and until
 * the departure day; while the payment is pending it re-checks on the same
 * cadence as the status, so the button appears when the payment lands.
 */
@Component({
  selector: 'app-booking-reservation-page',
  standalone: true,
  imports: [HotelReservationStatusComponent, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-hotel-reservation-status />

    @if (message(); as text) {
      <section class="mx-auto max-w-xl px-4 pb-8" data-testid="booking-checkin">
        <div class="space-y-3 rounded-lg border border-border p-4">
          <h2 class="flex items-center gap-2 font-semibold text-text-primary">
            <app-icon name="clipboard-check" [size]="18" />
            Check-in en línea
          </h2>
          <p class="text-sm text-text-secondary">{{ text }}</p>
          @if (checkin()?.path; as path) {
            <a
              [routerLink]="path"
              class="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
              data-testid="booking-checkin-link"
            >
              {{ checkin()?.state === 'completed' ? 'Revisar mi check-in' : 'Hacer check-in en línea' }}
            </a>
          }
        </div>
      </section>
    }
  `,
})
export class BookingReservationPageComponent {
  private readonly bookingPage = inject(BookingPageService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authenticated = toSignal(inject(AuthFacade).isAuthenticated$, {
    initialValue: false,
  });

  readonly checkin = signal<OnlineCheckin | null>(null);
  readonly message = computed(() => checkinMessage(this.checkin()?.state));

  private poll: Subscription | null = null;

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    effect(() => {
      if (!this.authenticated() || !Number.isInteger(id) || id <= 0) return;
      untracked(() => this.watch(id));
    });
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
  }

  private watch(id: number): void {
    this.poll?.unsubscribe();
    let polls = 0;
    this.poll = timer(0, POLL_MS)
      .pipe(
        switchMap(() => this.bookingPage.checkin(id)),
        // Keep asking only while the payment may still confirm the stay.
        takeWhile((view) => view.state === 'not_confirmed' && ++polls < MAX_POLLS, true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (view) => this.checkin.set(view),
        // Not this guest's reservation, or the API is down: no check-in card.
        error: () => this.checkin.set(null),
      });
  }
}
