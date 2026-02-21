import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import * as NotificationsActions from './notifications.actions';
import * as NotificationsSelectors from './notifications.selectors';

@Injectable({ providedIn: 'root' })
export class NotificationsFacade {
  private store = inject(Store);

  notifications$ = this.store.select(
    NotificationsSelectors.selectNotifications,
  );
  unreadCount$ = this.store.select(NotificationsSelectors.selectUnreadCount);
  loading$ = this.store.select(NotificationsSelectors.selectNotificationsLoading);
  sseConnected$ = this.store.select(NotificationsSelectors.selectSseConnected);

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
