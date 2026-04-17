import {
  Component,
  HostListener,
  inject,
  ElementRef,
  computed,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
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
        return d?.product_id
          ? `/admin/products/${d.product_id}`
          : '/admin/products';
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
      default:
        return null;
    }
  }

  getIconForType(type: string): string {
    const map: Record<string, string> = {
      new_order: 'shopping-cart',
      order_status_change: 'refresh-cw',
      low_stock: 'alert-triangle',
      new_customer: 'user-plus',
      payment_received: 'credit-card',
      layaway_payment_received: 'credit-card',
      layaway_payment_reminder: 'clock',
      layaway_overdue: 'alert-triangle',
      layaway_completed: 'check-circle',
      layaway_cancelled: 'x-circle',
      installment_reminder: 'clock',
      installment_overdue: 'alert-triangle',
      installment_paid: 'check-circle',
      credit_completed: 'trophy',
    };
    return map[type] ?? 'bell';
  }

  formatTime(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
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
