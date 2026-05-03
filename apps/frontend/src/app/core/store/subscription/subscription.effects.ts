import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType, ROOT_EFFECTS_INIT } from '@ngrx/effects';
import { of, Observable, EMPTY, interval, timer, race, defer, from } from 'rxjs';
import {
  map,
  mergeMap,
  catchError,
  switchMap,
  filter,
  takeUntil,
  concatMap,
  delay,
  expand,
  takeWhile,
} from 'rxjs/operators';
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
            map((response): Action => {
              const result = response.data;
              if (result?.state === 'failed') {
                return SubscriptionActions.retryPaymentFailure({
                  error:
                    'El pago fue rechazado. Intenta con otro método de pago.',
                });
              }
              return SubscriptionActions.retryPaymentSuccess({ result });
            }),
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
   * Phase 3 + Pull-fallback — Poll until the subscription transitions to
   * `active` after a Wompi widget close.
   *
   * Two flavors driven by the action payload:
   *   1. With `invoiceId` → on each tick: (a) call backend
   *      `POST checkout/invoices/:invoiceId/sync-from-gateway` so the
   *      backend reconciles directly with Wompi (works on localhost where
   *      the webhook can't land); then (b) refresh `/current`. If the sync
   *      response says `paid` we short-circuit immediately. This is the
   *      canonical path post-checkout.
   *   2. Without `invoiceId` → legacy polling against `/current` only,
   *      relying on a real Wompi webhook to flip the state. Kept for
   *      callers that don't yet pass the invoice id.
   *
   * Backoff schedule (no fixed `intervalMs` from caller): 2s, 3s, 5s, 8s,
   * 12s, then 12s thereafter. Cap of 10 attempts (~60s) before emitting
   * `pollFailed` so the UI can surface a "Reintentar verificación" CTA.
   * If `intervalMs` is supplied we honor it (legacy path).
   *
   * `switchMap` cancels any in-flight poll on a fresh dispatch.
   */
  pollSubscriptionUntilActive$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SubscriptionActions.pollSubscriptionUntilActive),
      switchMap(({ timeoutMs, intervalMs, invoiceId }) => {
        // Hard timeout still wins in any case. Default keeps backwards
        // compat with the legacy 30s default; raise to 60s when we are in
        // pull-fallback mode so the backoff schedule has room to finish.
        const deadline = timeoutMs ?? (invoiceId ? 60000 : 30000);
        const timeout$ = timer(deadline).pipe(
          map(() => SubscriptionActions.pollTimeout()),
        );

        // Cancellation streams — stop on success or on the (post-cap) failed
        // signal so the inner observable doesn't outlive the user-visible
        // outcome.
        const cancel$ = this.actions$.pipe(
          ofType(
            SubscriptionActions.pollSucceeded,
            SubscriptionActions.pollFailed,
            SubscriptionActions.pollTimeout,
          ),
        );

        // Backoff schedule for pull-fallback mode. Numbers chosen to balance
        // perceived snappiness (first check at 2s) against backend load:
        // 2 + 3 + 5 + 8 + 12 = 30s for the first 5 ticks; subsequent ticks
        // hold at 12s. Capped at 10 ticks (~78s aggregated) before we give
        // up and surface the manual CTA.
        const BACKOFF_MS = [2000, 3000, 5000, 8000, 12000, 12000, 12000, 12000, 12000, 12000];
        const MAX_ATTEMPTS = BACKOFF_MS.length;

        const tickFor = (attemptIdx: number): number => {
          if (intervalMs && intervalMs > 0) return intervalMs;
          return BACKOFF_MS[Math.min(attemptIdx, BACKOFF_MS.length - 1)];
        };

        // Per-tick action: returns the list of NgRx actions to dispatch
        // for the given attempt index. Network errors are swallowed so the
        // loop never aborts mid-flight — the timeout/cap branches own the
        // terminal decisions.
        const tick$ = (): Observable<Action[]> => {
          const sync$ = invoiceId
            ? this.http
                .post<{ success: boolean; data: any }>(
                  `${this.apiUrl}/store/subscriptions/checkout/invoices/${invoiceId}/sync-from-gateway`,
                  {},
                )
                .pipe(catchError(() => of(null)))
            : of(null);

          return sync$.pipe(
            mergeMap((syncRes) => {
              const syncStatus = syncRes?.data?.status as
                | 'paid'
                | 'failed'
                | 'pending'
                | 'no_transaction'
                | undefined;

              if (syncStatus === 'paid') {
                return this.http
                  .get<{ success: boolean; data: any }>(
                    `${this.apiUrl}/store/subscriptions/current`,
                  )
                  .pipe(
                    map((response): Action[] => [
                      SubscriptionActions.loadCurrentSuccess({
                        subscription: response?.data ?? null,
                      }),
                      SubscriptionActions.pollSucceeded(),
                    ]),
                    catchError((): Observable<Action[]> =>
                      of([SubscriptionActions.pollSucceeded()]),
                    ),
                  );
              }

              if (syncStatus === 'failed') {
                return of<Action[]>([
                  SubscriptionActions.pollFailed({
                    reason: 'gateway_declined',
                  }),
                ]);
              }

              // Pending / no_transaction / no invoiceId — refresh /current
              // so the banner reacts to listener-led promotions too.
              return this.http
                .get<{ success: boolean; data: any }>(
                  `${this.apiUrl}/store/subscriptions/current`,
                )
                .pipe(
                  map((response): Action[] => {
                    const sub = response?.data ?? null;
                    const status = sub?.status ?? sub?.state ?? null;
                    const updateAction =
                      SubscriptionActions.loadCurrentSuccess({
                        subscription: sub,
                      });
                    if (
                      status === 'active' ||
                      status === 'trialing' ||
                      status === 'trial'
                    ) {
                      return [
                        updateAction,
                        SubscriptionActions.pollSucceeded(),
                      ];
                    }
                    return [updateAction];
                  }),
                  catchError((): Observable<Action[]> => of([])),
                );
            }),
          );
        };

        // Sequential scheduler with backoff. Each attempt is wrapped as
        // a discrete observable that waits `tickFor(idx)` and then issues
        // its tick. We expand into the next attempt unless the previous
        // one terminated with succeeded/failed.
        type AttemptResult = { idx: number; actions: Action[] };
        const runAttempt = (idx: number): Observable<AttemptResult> =>
          timer(tickFor(idx)).pipe(
            switchMap(() => tick$()),
            map((actions) => ({ idx, actions })),
          );

        const polling$ = runAttempt(0).pipe(
          expand((prev) => {
            const terminal = prev.actions.some(
              (a) =>
                a.type === SubscriptionActions.pollSucceeded.type ||
                a.type === SubscriptionActions.pollFailed.type,
            );
            if (terminal) return EMPTY;
            const nextIdx = prev.idx + 1;
            if (nextIdx >= MAX_ATTEMPTS) {
              return of<AttemptResult>({
                idx: nextIdx,
                actions: [
                  SubscriptionActions.pollFailed({ reason: 'max_attempts' }),
                ],
              });
            }
            return runAttempt(nextIdx);
          }),
          concatMap((attempt) => from(attempt.actions)),
          takeUntil(cancel$),
        );

        return race(polling$, timeout$);
      }),
    ),
  );

  /**
   * After a retry finishes, refresh both the current subscription and the
   * dunning snapshot so the UI immediately reflects payment/state changes.
   */
  retryPaymentFinishedRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        SubscriptionActions.retryPaymentSuccess,
        SubscriptionActions.retryPaymentFailure,
      ),
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
