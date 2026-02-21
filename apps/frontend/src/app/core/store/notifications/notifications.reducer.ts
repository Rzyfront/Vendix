import { createReducer, on } from '@ngrx/store';
import * as NotificationsActions from './notifications.actions';
import { AppNotification } from './notifications.actions';

export interface NotificationsState {
  items: AppNotification[];
  unread_count: number;
  loading: boolean;
  error: string | null;
  sse_connected: boolean;
}

export const initialNotificationsState: NotificationsState = {
  items: [],
  unread_count: 0,
  loading: false,
  error: null,
  sse_connected: false,
};

export const notificationsReducer = createReducer(
  initialNotificationsState,

  on(NotificationsActions.loadNotifications, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(NotificationsActions.loadNotificationsSuccess, (state, { items, unread_count }) => ({
    ...state,
    items,
    unread_count,
    loading: false,
  })),

  on(NotificationsActions.loadNotificationsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(NotificationsActions.sseConnected, (state) => ({
    ...state,
    sse_connected: true,
  })),

  on(NotificationsActions.sseDisconnected, (state) => ({
    ...state,
    sse_connected: false,
  })),

  on(NotificationsActions.receivedNotification, (state, { notification }) => ({
    ...state,
    items: [notification, ...state.items].slice(0, 50),
    unread_count: state.unread_count + 1,
  })),

  on(NotificationsActions.markReadSuccess, (state, { id }) => ({
    ...state,
    items: state.items.map((item) =>
      item.id === id ? { ...item, is_read: true } : item,
    ),
    unread_count: Math.max(0, state.unread_count - 1),
  })),

  on(NotificationsActions.markAllReadSuccess, (state) => ({
    ...state,
    items: state.items.map((item) => ({ ...item, is_read: true })),
    unread_count: 0,
  })),
);
