import { createAction, props } from '@ngrx/store';

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  data?: any;
  is_read: boolean;
  created_at: string;
}

// Load notifications
export const loadNotifications = createAction('[Notifications] Load');

export const loadNotificationsSuccess = createAction(
  '[Notifications] Load Success',
  props<{ items: AppNotification[]; unread_count: number }>(),
);

export const loadNotificationsFailure = createAction(
  '[Notifications] Load Failure',
  props<{ error: string }>(),
);

// SSE connection
export const connectSse = createAction('[Notifications] Connect SSE');
export const sseConnected = createAction('[Notifications] SSE Connected');
export const sseDisconnected = createAction('[Notifications] SSE Disconnected');
export const disconnectSse = createAction('[Notifications] Disconnect SSE');

export const receivedNotification = createAction(
  '[Notifications] Received via SSE',
  props<{ notification: AppNotification }>(),
);

// Mark read
export const markRead = createAction(
  '[Notifications] Mark Read',
  props<{ id: number }>(),
);

export const markReadSuccess = createAction(
  '[Notifications] Mark Read Success',
  props<{ id: number }>(),
);

export const markAllRead = createAction('[Notifications] Mark All Read');

export const markAllReadSuccess = createAction(
  '[Notifications] Mark All Read Success',
);
