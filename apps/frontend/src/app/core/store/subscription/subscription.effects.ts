import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType, ROOT_EFFECTS_INIT } from '@ngrx/effects';
import { of, Observable, EMPTY } from 'rxjs';
import { map, mergeMap, catchError, switchMap, filter } from 'rxjs/operators';
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

  /**
   * Sprint 1 / S1.2 — When the active store changes, fetch the new store's
   * subscription. The reducer has already wiped stale data; this effect
   * refills it. We skip the fetch when storeId is null (ORG_ADMIN /
   * SUPER_ADMIN / logout) — those scopes don't show the banner anyway.
   */
  contextChangedReload$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.subscriptionContextChanged),
      filter(({ storeId }) => storeId !== null),
      map(() => SubscriptionActions.loadCurrent()),
    ),
  );

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
            // The cancel endpoint returns the raw store_subscriptions row,
            // which lacks the plan_name/plan_code joins shown in the hero.
            // Chain loadCurrent so the UI keeps the enriched payload after
            // cancellation completes.
            mergeMap((response) => [
              SubscriptionActions.cancelSuccess({ subscription: response.data }),
              SubscriptionActions.loadCurrent(),
            ]),
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

  scheduleCancel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.scheduleCancel),
      mergeMap(({ reason }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/cancel`,
            { reason, end_of_cycle: true },
          )
          .pipe(
            // Same as cancel$ — the response is the raw row without the
            // plan join, so we re-fetch /current to restore enriched fields.
            mergeMap((response) => [
              SubscriptionActions.scheduleCancelSuccess({ subscription: response.data }),
              SubscriptionActions.loadCurrent(),
            ]),
            catchError((error) =>
              of(
                SubscriptionActions.scheduleCancelFailure({
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

  loadDunningState$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.loadDunningState),
      mergeMap(() =>
        this.http
          .get<{ success: boolean; data: SubscriptionActions.DunningState }>(
            `${this.apiUrl}/store/subscriptions/current/dunning-state`,
          )
          .pipe(
            map((response) =>
              SubscriptionActions.loadDunningStateSuccess({
                dunning: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.loadDunningStateFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  retryPayment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.retryPayment),
      mergeMap(() =>
        this.http
          .post<{
            success: boolean;
            data: { payment_id: number; invoice_id: number; state: string };
          }>(`${this.apiUrl}/store/subscriptions/retry-payment`, {})
          .pipe(
            map((response) =>
              SubscriptionActions.retryPaymentSuccess({
                result: response.data,
              }),
            ),
            catchError((error) =>
              of(
                SubscriptionActions.retryPaymentFailure({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /**
   * S2.1 — Validate a redemption code against the backend. Maps the
   * discriminated success/failure response into the corresponding NgRx
   * actions so reducers can keep the coupon UI deterministic.
   */
  validateCoupon$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.validateCoupon),
      mergeMap(({ code }) =>
        this.http
          .post<{ success: boolean; data: any }>(
            `${this.apiUrl}/store/subscriptions/checkout/validate-coupon`,
            { code },
          )
          .pipe(
            map((response): Action => {
              const data = response?.data ?? {};
              if (data.valid && data.plan) {
                return SubscriptionActions.validateCouponSuccess({
                  coupon: {
                    code,
                    plan: data.plan,
                    overlay_features: data.overlay_features ?? {},
                    duration_days: data.duration_days ?? null,
                    starts_at: data.starts_at ?? null,
                    expires_at: data.expires_at ?? null,
                  },
                });
              }
              return SubscriptionActions.validateCouponFailure({
                reason: (data.reason ?? 'not_found') as any,
                reasons_blocked: data.reasons_blocked,
              });
            }),
            catchError((error) =>
              of(
                SubscriptionActions.validateCouponError({
                  error: normalizeApiPayload(error),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /**
   * After a successful retry, refresh both the current subscription and the
   * dunning snapshot so the UI immediately reflects state changes (e.g. back
   * to active when the charge succeeded synchronously).
   */
  retryPaymentSuccessRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.retryPaymentSuccess),
      mergeMap(() => [
        SubscriptionActions.loadCurrent(),
        SubscriptionActions.loadDunningState(),
      ]),
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
            eventSource.close();
            observer.complete();
          };

          return () => {
            eventSource.close();
          };
        });
      }),
    ),
  );
}
