import {
  Component,
  inject,
  signal,
  effect,
  untracked,
  computed,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  NotificationsFacade,
  AppNotification,
} from '../../../../core/store/notifications';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Sticky banner shown beneath the header when a customer has checked in
 * for a booking and is waiting to be attended.
 *
 * - Subscribes to `NotificationsFacade.notifications()` (signal) and
 *   filters unread `booking_arrival` entries.
 * - Auto-dismisses when the user navigates to the booking or marks it read.
 * - Triggers a long-lived toast on first arrival so the staff gets the
 *   "Cliente llegó" alert even if they were on a different page when the
 *   SSE event arrived.
 *
 * The SSE-sound effect (`NotificationsEffects.playSound$`) plays the
 * configured notification sound automatically — no extra wiring needed.
 *
 * Zoneless / signals-only — no `markForCheck`, no `subscribe` without
 * `takeUntilDestroyed`.
 */
@Component({
  selector: 'app-arrival-banner',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './arrival-banner.component.html',
  styleUrls: ['./arrival-banner.component.scss'],
})
export class ArrivalBannerComponent {
  private facade = inject(NotificationsFacade);
  private router = inject(Router);
  private toast = inject(ToastService);

  /**
   * Pending arrivals — unread booking_arrival notifications, sorted by
   * most recent first.
   */
  readonly pendingArrivals = signal<AppNotification[]>([]);

  /**
   * Map of notification IDs we've already toasted for. Prevents spamming
   * the toast container when the user navigates between pages that both
   * mount this banner.
   */
  private readonly toastedIds = new Set<number>();

  readonly count = computed(() => this.pendingArrivals().length);

  constructor() {
    effect(() => {
      const all = this.facade.notifications();
      const arrivals = untracked(() =>
        all.filter(
          (n) => n.type === 'booking_arrival' && !n.is_read,
        ),
      );

      // Detect new arrivals (in current list but not toasted yet)
      for (const a of arrivals) {
        if (!this.toastedIds.has(a.id)) {
          this.toastedIds.add(a.id);
          this.toast.show({
            title: 'Cliente llegó',
            description: `${a.data?.customer_name ?? 'Cliente'} — ${a.data?.service_name ?? 'servicio'}`,
            variant: 'warning',
            duration: 8000,
          });
        }
      }

      // Drop toast-tracking for arrivals that are now read or removed
      const stillPendingIds = new Set(arrivals.map((a) => a.id));
      for (const id of this.toastedIds) {
        if (!stillPendingIds.has(id)) {
          this.toastedIds.delete(id);
        }
      }

      this.pendingArrivals.set(arrivals);
    });
  }

  attend(n: AppNotification): void {
    this.facade.markRead(n.id);
    const bookingId = n.data?.booking_id;
    this.router.navigate(
      ['/admin/reservations'],
      bookingId ? { queryParams: { booking_id: bookingId } } : {},
    );
  }

  dismiss(n: AppNotification): void {
    this.facade.markRead(n.id);
  }
}