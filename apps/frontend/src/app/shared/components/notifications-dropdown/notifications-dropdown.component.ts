import {
  Component,
  HostListener,
  inject,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { NotificationsFacade, AppNotification } from '../../../core/store/notifications';

@Component({
  selector: 'app-notifications-dropdown',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="notif-dropdown-container" [class.open]="isOpen">
      <!-- Bell trigger button -->
      <button
        class="notif-trigger"
        (click)="toggleDropdown($event)"
        [attr.aria-label]="'Notificaciones'"
        [attr.aria-expanded]="isOpen"
      >
        <app-icon name="bell" [size]="18"></app-icon>
        <span
          *ngIf="(unreadCount$ | async) as count"
          class="notif-badge"
        >
          {{ count > 99 ? '99+' : count }}
        </span>
      </button>

      <!-- Dropdown panel -->
      <div class="notif-panel" [class.show]="isOpen">
        <div class="notif-header">
          <span class="notif-title">Notificaciones</span>
          <button
            *ngIf="(unreadCount$ | async)! > 0"
            class="notif-mark-all"
            (click)="markAllRead($event)"
          >
            Marcar todo leído
          </button>
        </div>

        <div class="notif-list">
          <ng-container *ngFor="let n of (notifications$ | async)">
            <div
              class="notif-item"
              [class.unread]="!n.is_read"
              (click)="onNotificationClick(n)"
            >
              <div class="notif-icon-wrap" [attr.data-type]="n.type">
                <app-icon [name]="getIconForType(n.type)" [size]="16"></app-icon>
              </div>
              <div class="notif-content">
                <p class="notif-item-title">{{ n.title }}</p>
                <p class="notif-item-body">{{ n.body }}</p>
                <span class="notif-item-time">{{ formatTime(n.created_at) }}</span>
              </div>
              <div *ngIf="!n.is_read" class="notif-dot"></div>
            </div>
          </ng-container>

          <div
            *ngIf="(notifications$ | async)?.length === 0"
            class="notif-empty"
          >
            <app-icon name="bell" [size]="32" class="notif-empty-icon"></app-icon>
            <p>Sin notificaciones</p>
          </div>
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

  isOpen = false;
  notifications$ = this.notifFacade.notifications$;
  unreadCount$ = this.notifFacade.unreadCount$;

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }

  @HostListener('keydown.escape')
  onEscape() {
    this.isOpen = false;
  }

  toggleDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.isOpen = !this.isOpen;
  }

  markAllRead(event: MouseEvent) {
    event.stopPropagation();
    this.notifFacade.markAllRead();
  }

  onNotificationClick(n: AppNotification) {
    if (!n.is_read) {
      this.notifFacade.markRead(n.id);
    }
    this.isOpen = false;

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
        return d?.order_id ? `/admin/orders/${d.order_id}` : '/admin/orders/sales';
      case 'new_customer':
        return d?.customer_id ? `/admin/customers/${d.customer_id}` : '/admin/customers/all';
      case 'low_stock':
        return d?.product_id ? `/admin/products/${d.product_id}` : '/admin/products';
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
