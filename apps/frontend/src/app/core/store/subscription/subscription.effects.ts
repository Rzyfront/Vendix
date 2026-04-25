import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType, ROOT_EFFECTS_INIT } from '@ngrx/effects';
import { of, Observable, EMPTY } from 'rxjs';
import { map, mergeMap, catchError, switchMap } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { Action } from '@ngrx/store';
import { environment } from '../../../../environments/environment';
import { normalizeApiPayload } from '../../utils/api-error-handler';
import * as SubscriptionActions from './subscription.actions';

@Injectable()
export class SubscriptionEffects {
  private actions$ = inject(Actions);
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  loadCurrent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.loadCurrent),
      mergeMap(() =>
        this.http
          .get<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/current`,
          )
          .pipe(
            map((response) =>
              SubscriptionActions.loadCurrentSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.loadCurrentFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  loadAccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.loadAccess),
      mergeMap(() =>
        this.http
          .get<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/current/access`,
          )
          .pipe(
            map((response) =>
              SubscriptionActions.loadAccessSuccess({
                access: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.loadAccessFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  subscribe$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.subscribe),
      mergeMap(({ planId, partnerOverrideId }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/subscribe`,
            { planId, partnerOverrideId },
          )
          .pipe(
            map((response) =>
              SubscriptionActions.subscribeSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.subscribeFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  cancel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.cancel),
      mergeMap(({ reason }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/cancel`,
            { reason },
          )
          .pipe(
            map((response) =>
              SubscriptionActions.cancelSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.cancelFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  changePlan$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.changePlan),
      mergeMap(({ planId }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/checkout/commit`,
            { planId },
          )
          .pipe(
            map((response) =>
              SubscriptionActions.changePlanSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.changePlanFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  checkoutPreview$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.checkoutPreview),
      mergeMap(({ planId }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/checkout/preview`,
            { planId },
          )
          .pipe(
            map((response) =>
              SubscriptionActions.checkoutPreviewSuccess({
                preview: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.checkoutPreviewFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  checkoutCommit$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.checkoutCommit),
      mergeMap(({ planId, paymentMethodId }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/checkout/commit`,
            { planId, paymentMethodId },
          )
          .pipe(
            map((response) =>
              SubscriptionActions.checkoutCommitSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.checkoutCommitFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  loadInvoices$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.loadInvoices),
      mergeMap(() =>
        this.http
          .get<{ success: boolean; data: any[] }>(
            `${this.apiUrl}/store/subscriptions/current/invoices`,
          )
          .pipe(
            map((response) =>
              SubscriptionActions.loadInvoicesSuccess({
                invoices: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.loadInvoicesFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  loadSubscription$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.loadSubscription),
      mergeMap(() =>
        this.http
          .get<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/current/access`,
          )
          .pipe(
            map((response) =>
              SubscriptionActions.loadSubscriptionSuccess({
                subscription: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.loadSubscriptionFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  sseSubscriptionUpdated$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ROOT_EFFECTS_INIT),
      switchMap(() => {
        if (typeof window === 'undefined') {
          return EMPTY;
        }
        return new Observable<Action>((observer) => {
          const authState = localStorage.getItem('vendix_auth_state');
          if (!authState) {
            return;
          }

          let token: string | null = null;
          try {
            token = JSON.parse(authState)?.tokens?.access_token ?? null;
          } catch {
            return;
          }

          if (!token) {
            return;
          }

          const url = `${this.apiUrl}/store/notifications/stream?token=${token}`;
          const eventSource = new EventSource(url);

          eventSource.onmessage = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data?.type === 'subscription.updated') {
                observer.next(
                  SubscriptionActions.subscriptionUpdated({
                    subscription: data.data ?? data.subscription ?? {},
                  }),
                );
              }
            } catch {
              // Ignore malformed SSE messages
            }
          };

          eventSource.onerror = () => {
            // EventSource auto-reconnects — we don't complete the observable
          };

          return () => {
            eventSource.close();
          };
        });
      }),
    ),
  );
}
