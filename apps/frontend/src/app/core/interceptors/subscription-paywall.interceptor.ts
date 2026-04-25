import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SubscriptionAccessService } from '../services/subscription-access.service';

/**
 * Error codes that should trigger the paywall modal.
 *
 * Backend emits these via `VendixHttpException` with HTTP 402/403. The codes
 * map to subscription / plan / trial enforcement scenarios documented in the
 * `vendix-subscription-gate` and `vendix-error-handling` skills.
 */
const BLOCKING_CODES = new Set<string>([
  'SUBSCRIPTION_004',
  'SUBSCRIPTION_005',
  'SUBSCRIPTION_006',
  'SUBSCRIPTION_008',
  'SUBSCRIPTION_009',
  'PLAN_001',
  'TRIAL_001',
]);

/**
 * Functional HTTP interceptor that listens for subscription / plan enforcement
 * errors (HTTP 402/403 with a known `error_code`) and opens the paywall modal
 * via `SubscriptionAccessService`. The error is always re-thrown so callers
 * can still handle/log it locally.
 *
 * Order: must run AFTER auth interceptor (so token refresh on 401 happens
 * first) — register it last in the `withInterceptors([...])` chain.
 */
export const subscriptionPaywallInterceptor: HttpInterceptorFn = (req, next) => {
  const access = inject(SubscriptionAccessService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const body = err.error as { error_code?: string; message?: string } | null | undefined;
        const code = body?.error_code ?? '';
        const blocking =
          (err.status === 402 || err.status === 403) && BLOCKING_CODES.has(code);
        if (blocking) {
          try {
            access.openPaywall(code, body?.message);
          } catch {
            // Swallow modal open errors so the original HTTP error still
            // propagates to the caller.
          }
        }
      }
      return throwError(() => err);
    }),
  );
};
