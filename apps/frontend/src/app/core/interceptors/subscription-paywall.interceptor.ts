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
  'SUBSCRIPTION_003',
  'SUBSCRIPTION_004',
  'SUBSCRIPTION_005',
  'SUBSCRIPTION_006',
  'SUBSCRIPTION_007',
  'SUBSCRIPTION_008',
  'SUBSCRIPTION_009',
  'PLAN_001',
  'TRIAL_001',
]);

const DUNNING_ROUTE = '/admin/subscription/dunning';
const PICKER_ROUTE = '/admin/subscription/picker';

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
          // Always open the paywall modal first — informative UX comes
          // before any redirect. The modal contains the CTA that takes the
          // user to the picker / dunning / plans page, so we let the modal
          // drive navigation instead of redirecting silently. Skip the
          // modal only when the user is already on the destination page
          // (avoids stacking duplicate modals on top of the dunning board
          // or the picker, which already display their own state UI).
          const onPickerPath = router.url.startsWith(PICKER_ROUTE);
          const onDunningPath = router.url === DUNNING_ROUTE;
          const onSubscriptionTree = router.url.startsWith('/admin/subscription');
          // We still suppress the modal if the user is already deep in the
          // subscription tree on the matching destination page — the page
          // itself will surface the modal via its own effect.
          const suppressModal =
            (code === 'SUBSCRIPTION_004' &&
              body?.details?.subscription_state === 'no_plan' &&
              onPickerPath) ||
            ((code === 'SUBSCRIPTION_008' || code === 'SUBSCRIPTION_009') &&
              onDunningPath) ||
            // The /admin/subscription page (my-subscription) opens its own
            // paywall modal via effect — let that flow win.
            (router.url === '/admin/subscription' && onSubscriptionTree);
          if (!suppressModal) {
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
