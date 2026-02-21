import { Injectable, inject, NgZone } from '@angular/core';
import { Actions, createEffect, ofType, ROOT_EFFECTS_INIT } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  switchMap,
  map,
  catchError,
  mergeMap,
  tap,
  take,
  filter,
} from 'rxjs/operators';
import { of, Observable, EMPTY } from 'rxjs';
import { Action } from '@ngrx/store';
import { NotificationsApiService } from '../../services/notifications.service';
import { PushSubscriptionService } from '../../services/push-subscription.service';
import * as NotificationsActions from './notifications.actions';
import * as AuthActions from '../auth/auth.actions';
import { AppNotification } from './notifications.actions';
import { selectIsAuthenticated } from '../auth/auth.selectors';

@Injectable()
export class NotificationsEffects {
  private actions$ = inject(Actions);
  private notificationsService = inject(NotificationsApiService);
  private store = inject(Store);
  private ngZone = inject(NgZone);

  private pushService = inject(PushSubscriptionService);
  private eventSource: EventSource | null = null;

  /**
   * Fires once when NgRx effects initialize.
   * Covers page-reload where hydrateAuthState() already populated auth
   * but no login action was dispatched.
   */
  init$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ROOT_EFFECTS_INIT),
      switchMap(() =>
        this.store.select(selectIsAuthenticated).pipe(
          take(1),
          filter((isAuth) => isAuth),
          switchMap(() => [
            NotificationsActions.loadNotifications(),
            NotificationsActions.connectSse(),
          ]),
        ),
      ),
    ),
  );

  load$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationsActions.loadNotifications),
      switchMap(() =>
        this.notificationsService.getAll({ limit: 15 }).pipe(
          map((response: any) =>
            NotificationsActions.loadNotificationsSuccess({
              items: response.data || [],
              unread_count: response.meta?.unread_count ?? 0,
            }),
          ),
          catchError((error) =>
            of(
              NotificationsActions.loadNotificationsFailure({
                error: error.message,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  connectSse$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationsActions.connectSse),
      switchMap(() => {
        return new Observable<Action>((observer) => {
          // Close existing connection if any
          if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
          }

          const url = this.notificationsService.getSseUrl();
          if (!url) {
            observer.next(NotificationsActions.sseDisconnected());
            return;
          }

          this.eventSource = new EventSource(url);

          this.eventSource.onopen = () => {
            this.ngZone.run(() => {
              observer.next(NotificationsActions.sseConnected());
            });
          };

          this.eventSource.onmessage = (event: MessageEvent) => {
            this.ngZone.run(() => {
              try {
                const data = JSON.parse(event.data);
                const notification: AppNotification = {
                  id: data.id,
                  type: data.type,
                  title: data.title,
                  body: data.body,
                  data: data.data,
                  is_read: false,
                  created_at: data.created_at,
                };
                observer.next(
                  NotificationsActions.receivedNotification({ notification }),
                );
              } catch {
                // Ignore malformed SSE messages
              }
            });
          };

          this.eventSource.onerror = () => {
            this.ngZone.run(() => {
              observer.next(NotificationsActions.sseDisconnected());
            });
            // EventSource auto-reconnects — we don't complete the observable
          };

          return () => {
            if (this.eventSource) {
              this.eventSource.close();
              this.eventSource = null;
            }
          };
        });
      }),
    ),
  );

  disconnectSse$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(NotificationsActions.disconnectSse, AuthActions.logoutSuccess),
        tap(() => {
          if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
          }
        }),
      ),
    { dispatch: false },
  );

  initAfterLogin$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AuthActions.loginSuccess,
        AuthActions.loginCustomerSuccess,
        AuthActions.restoreAuthState,
      ),
      switchMap(() => [
        NotificationsActions.loadNotifications(),
        NotificationsActions.connectSse(),
      ]),
    ),
  );

  /**
   * After SSE connects, silently register push SW and refresh subscription
   * if the user has already granted notification permission.
   */
  registerPushSw$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(NotificationsActions.sseConnected),
        tap(() => {
          if (this.pushService.isSupported && this.pushService.permissionState === 'granted') {
            this.pushService.refreshSubscription();
          }
        }),
      ),
    { dispatch: false },
  );

  markRead$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationsActions.markRead),
      mergeMap(({ id }) =>
        this.notificationsService.markRead(id).pipe(
          map(() => NotificationsActions.markReadSuccess({ id })),
          catchError(() => EMPTY),
        ),
      ),
    ),
  );

  markAllRead$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationsActions.markAllRead),
      mergeMap(() =>
        this.notificationsService.markAllRead().pipe(
          map(() => NotificationsActions.markAllReadSuccess()),
          catchError(() => EMPTY),
        ),
      ),
    ),
  );
}
