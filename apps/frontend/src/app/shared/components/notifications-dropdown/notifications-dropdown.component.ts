import {
  Component,
  HostListener,
  inject,
  ElementRef,
  computed,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { map, timer } from 'rxjs';
import { IconComponent } from '../icon/icon.component';
import {
  NotificationsFacade,
  AppNotification,
} from '../../../core/store/notifications';

@Component({
  selector: 'app-notifications-dropdown',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="notif-dropdown-container" [class.open]="isOpen()">
      <!-- Bell trigger button -->
      <button
        class="notif-trigger"
        (click)="toggleDropdown($event)"
        [attr.aria-label]="'Notificaciones'"
        [attr.aria-expanded]="isOpen()"
      >
        <app-icon name="bell" [size]="18"></app-icon>
        @if (unreadCount(); as count) {
          <span class="notif-badge">
            {{ count > 99 ? '99+' : count }}
          </span>
        }
      </button>

      <!-- Dropdown panel -->
      <div class="notif-panel" [class.show]="isOpen()">
        <div class="notif-header">
          <span class="notif-title">Notificaciones</span>
          @if (unreadCount()! > 0) {
            <button class="notif-mark-all" (click)="markAllRead($event)">
              Marcar todo leído
            </button>
          }
        </div>

        <div class="notif-list">
          @for (n of notifications(); track n) {
            <div
              class="notif-item"
              [class.unread]="!n.is_read"
              (click)="onNotificationClick(n)"
            >
              <div class="notif-icon-wrap" [attr.data-type]="n.type">
                <app-icon
                  [name]="getIconForType(n.type)"
                  [size]="16"
                ></app-icon>
              </div>
              <div class="notif-content">
                <p class="notif-item-title">{{ n.title }}</p>
                <p class="notif-item-body">{{ n.body }}</p>
                <span class="notif-item-time">{{
                  formatTime(n.created_at)
                }}</span>
              </div>
              @if (!n.is_read) {
                <div class="notif-dot"></div>
              }
            </div>
          }

          @if (notifications().length === 0) {
            <div class="notif-empty">
              <app-icon
                name="bell"
                [size]="32"
                class="notif-empty-icon"
              ></app-icon>
              <p>Sin notificaciones</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./notifications-dropdown.component.scss'],
})
export class NotificationsDropdownComponent {
  private notifFacade = inject(NotificationsFacade);
  private elementRef = inject(ElementRef);
  private router = inject(Router);

  readonly isOpen = signal(false);
  private readonly relativeTimeNow = toSignal(
    timer(0, 60_000).pipe(map(() => Date.now())),
    { initialValue: Date.now() },
  );

  // Signal-based properties from facade
  readonly notifications = this.notifFacade.notifications;
  readonly unreadCount = computed(() => this.notifFacade.unreadCount());

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('keydown.escape')
  onEscape() {
    this.isOpen.set(false);
  }

  toggleDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.isOpen.update((v) => !v);
  }

  markAllRead(event: MouseEvent) {
    event.stopPropagation();
    this.notifFacade.markAllRead();
  }

  onNotificationClick(n: AppNotification) {
    if (!n.is_read) {
      this.notifFacade.markRead(n.id);
    }
    this.isOpen.set(false);

    const route = this.getRouteForNotification(n);
    if (route) {
      this.router.navigateByUrl(route);
    }
  }

  private getRouteForNotification(n: AppNotification): string | null {
    const d = n.data;
    const explicitRoute = this.getSafeRoute(d?.route ?? d?.url);
    if (explicitRoute) return explicitRoute;

    switch (n.type) {
      case 'new_order':
      case 'order_status_change':
      case 'payment_received':
        return d?.order_id
          ? `/admin/orders/${d.order_id}`
          : '/admin/orders/sales';
      case 'new_customer':
        return d?.customer_id
          ? `/admin/customers/${d.customer_id}`
          : '/admin/customers/all';
      case 'low_stock':
        // Navigate to the consolidated stock-by-product view. The user
        // sees the product's stock across all warehouses — useful to
        // know that 'Camisa Polo está baja en Bodega X pero tiene 25 en Sur'.
        return d?.product_id
          ? `/admin/inventory/stock/${d.product_id}`
          : '/admin/products';
      case 'new_review':
        return d?.review_id
          ? `/admin/customers/reviews?review_id=${d.review_id}`
          : '/admin/customers/reviews';
      case 'layaway_payment_received':
      case 'layaway_payment_reminder':
      case 'layaway_overdue':
      case 'layaway_completed':
      case 'layaway_cancelled':
        return d?.plan_id
          ? `/admin/orders/layaway/${d.plan_id}`
          : '/admin/orders/layaway';
      case 'installment_reminder':
      case 'installment_overdue':
      case 'installment_paid':
      case 'credit_completed':
        return '/admin/orders/sales';
      case 'booking_created':
      case 'booking_confirmed':
      case 'booking_cancelled':
      case 'booking_no_show':
      case 'booking_reminder':
      case 'booking_rescheduled':
      case 'booking_started':
      case 'booking_completed':
      case 'booking_arrival':
      case 'booking_attending':
      case 'booking_check_in':
      case 'booking_confirmation_request':
      case 'booking_auto_cancelled':
        return d?.booking_id
          ? `/admin/reservations?booking_id=${d.booking_id}`
          : '/admin/reservations';
      // Dine-in QR-por-mesa — staff flow (E2 deep-links).
      // `table_session_id` is the route param (under `tables/session/:id`)
      // so clicking a notification opens the mesero session page, where
      // the pending-payments section lives and where the mesero can
      // reconcile / fire / mark delivered.
      case 'table_payment_pending':
      case 'table_payment_confirmed':
      case 'table_request_bill':
        return d?.table_session_id
          ? `/admin/restaurant-ops/tables/session/${d.table_session_id}`
          : '/admin/restaurant-ops/tables';
      default:
        return null;
    }
  }

  private getSafeRoute(route: unknown): string | null {
    if (typeof route !== 'string') return null;
    if (!route.startsWith('/') || route.startsWith('//')) return null;
    return route;
  }

  getIconForType(type: string): string {
    const map: Record<string, string> = {
      new_order: 'shopping-cart',
      order_status_change: 'refresh-cw',
      low_stock: 'alert-triangle',
      new_customer: 'user-plus',
      payment_received: 'credit-card',
      new_review: 'star',
      layaway_payment_received: 'credit-card',
      layaway_payment_reminder: 'clock',
      layaway_overdue: 'alert-triangle',
      layaway_completed: 'check-circle',
      layaway_cancelled: 'x-circle',
      installment_reminder: 'clock',
      installment_overdue: 'alert-triangle',
      installment_paid: 'check-circle',
      credit_completed: 'trophy',
      // Bookings — arrival & attending are the most urgent
      booking_created: 'calendar-plus',
      booking_confirmed: 'calendar-check',
      booking_cancelled: 'calendar-x',
      booking_no_show: 'user-x',
      booking_reminder: 'bell-ring',
      booking_rescheduled: 'calendar-clock',
      booking_started: 'play-circle',
      booking_completed: 'check-circle-2',
      booking_arrival: 'door-open',
      booking_attending: 'user-check',
      booking_check_in: 'door-open',
      booking_confirmation_request: 'message-circle',
      booking_auto_cancelled: 'calendar-x',
      // Dine-in QR-por-mesa — llamados desde la mesa del comensal
      table_call_waiter: 'concierge-bell',
      table_request_bill: 'receipt',
      table_request_split: 'split',
      // Staff-side payment reconciliation (E2). `pending` is the loud
      // one (cash in hand, needs reconciliation); `confirmed` is the
      // success acknowledgement — info-tier to avoid burying pending.
      table_payment_pending: 'bell-ring',
      table_payment_confirmed: 'circle-check',
    };
    return map[type] ?? 'bell';
  }

  formatTime(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      const diff = this.relativeTimeNow() - date.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);

      if (minutes < 1) return 'Ahora';
      if (minutes < 60) return `hace ${minutes}m`;
      if (hours < 24) return `hace ${hours}h`;
      return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  }
}
