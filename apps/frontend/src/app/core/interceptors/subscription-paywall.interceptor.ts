import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import {
  PaywallDetails,
  SubscriptionAccessService,
} from '../services/subscription-access.service';

/**
 * Error codes that should trigger the paywall modal.
 *
 * Backend emits these via `VendixHttpException` with HTTP 402/403/409. The
 * codes map to subscription / plan / trial enforcement scenarios documented
 * in the `vendix-subscription-gate` and `vendix-error-handling` skills.
 *
 * NOTE: We intentionally filter by `error_code` (not by HTTP status) because
 * the backend gate emits the same business codes across multiple statuses
 * (402 for payment-required, 403 for access-denied, 409 for state conflicts).
 * Filtering by status excluded valid 409 cases and produced silent no-modal
 * regressions.
 */
const BLOCKING_CODES = new Set<string>([
  'SUBSCRIPTION_002',
  'SUBSCRIPTION_004',
  'SUBSCRIPTION_005',
  'SUBSCRIPTION_006',
  'SUBSCRIPTION_008',
  'SUBSCRIPTION_009',
  'PLAN_001',
  'TRIAL_001',
]);

/**
 * Subset of error codes that indicate the store is hard-blocked from
 * operating (suspended/blocked). For these codes the interceptor also
 * navigates the user to the dunning board, where they can pay and recover
 * access without leaving the panel.
 */
const DUNNING_REDIRECT_CODES = new Set<string>([
  'SUBSCRIPTION_008',
  'SUBSCRIPTION_009',
]);

const DUNNING_ROUTE = '/admin/subscription/dunning';

/**
 * Functional HTTP interceptor that listens for subscription / plan enforcement
 * errors (any HTTP status with a known `error_code`) and opens the paywall
 * modal via `SubscriptionAccessService`. The error is always re-thrown so
 * callers can still handle/log it locally.
 *
 * Order: must run AFTER auth interceptor (so token refresh on 401 happens
 * first) — register it last in the `withInterceptors([...])` chain.
 */
export const subscriptionPaywallInterceptor: HttpInterceptorFn = (req, next) => {
  const access = inject(SubscriptionAccessService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const body = err.error as
          | {
              error_code?: string;
              message?: string;
              details?: PaywallDetails;
            }
          | null
          | undefined;
        const code = body?.error_code ?? '';
        const blocking = BLOCKING_CODES.has(code);
        if (blocking) {
          // For suspended/blocked we redirect the user into the dunning
          // board (where they can pay) rather than only opening the paywall
          // modal. The modal remains the right surface for the
          // softer/feature-gating codes (002/005/006) and for triggers
          // happening anywhere outside the /admin/subscription/* tree.
          const shouldRedirect =
            DUNNING_REDIRECT_CODES.has(code) &&
            router.url !== DUNNING_ROUTE;
          if (shouldRedirect) {
            try {
              router.navigateByUrl(DUNNING_ROUTE);
            } catch {
              // Routing failures fall back to the modal below.
            }
          }
          // Skip the modal when the user is already on the dunning board
          // (or about to be redirected there); otherwise show the paywall.
          const onDunningPath =
            router.url === DUNNING_ROUTE || shouldRedirect;
          if (!onDunningPath) {
            try {
              access.openPaywall(code, body?.message, body?.details);
            } catch {
              // Swallow modal open errors so the original HTTP error still
              // propagates to the caller.
            }
          }
        }
      }
      return throwError(() => err);
    }),
  );
};
