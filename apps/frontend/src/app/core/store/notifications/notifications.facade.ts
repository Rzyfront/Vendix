import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import * as NotificationsActions from './notifications.actions';
import * as NotificationsSelectors from './notifications.selectors';

@Injectable({ providedIn: 'root' })
export class NotificationsFacade {
  private store = inject(Store);

  readonly notifications$ = this.store.select(
    NotificationsSelectors.selectNotifications,
  );
  readonly unreadCount$ = this.store.select(NotificationsSelectors.selectUnreadCount);
  readonly loading$ = this.store.select(NotificationsSelectors.selectNotificationsLoading);
  readonly sseConnected$ = this.store.select(NotificationsSelectors.selectSseConnected);

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  readonly notifications = toSignal(this.notifications$, { initialValue: [] as any[] });
  readonly unreadCount = toSignal(this.unreadCount$, { initialValue: 0 });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly sseConnected = toSignal(this.sseConnected$, { initialValue: false });

  loadNotifications() {
    this.store.dispatch(NotificationsActions.loadNotifications());
  }

  connectSse() {
    this.store.dispatch(NotificationsActions.connectSse());
  }

  disconnectSse() {
    this.store.dispatch(NotificationsActions.disconnectSse());
  }

  markRead(id: number) {
    this.store.dispatch(NotificationsActions.markRead({ id }));
  }

  markAllRead() {
    this.store.dispatch(NotificationsActions.markAllRead());
  }
}
