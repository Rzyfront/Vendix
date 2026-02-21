import { createSelector, createFeatureSelector } from '@ngrx/store';
import { NotificationsState } from './notifications.reducer';

export const selectNotificationsState =
  createFeatureSelector<NotificationsState>('notifications');

export const selectNotifications = createSelector(
  selectNotificationsState,
  (state) => state.items,
);

export const selectUnreadCount = createSelector(
  selectNotificationsState,
  (state) => state.unread_count,
);

export const selectNotificationsLoading = createSelector(
  selectNotificationsState,
  (state) => state.loading,
);

export const selectSseConnected = createSelector(
  selectNotificationsState,
  (state) => state.sse_connected,
);

export const selectUnreadNotifications = createSelector(
  selectNotifications,
  (items) => items.filter((item) => !item.is_read),
);
