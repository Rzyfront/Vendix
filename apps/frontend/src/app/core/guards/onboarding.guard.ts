import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';

/**
 * Owner onboarding gate.
 *
 * Forces OWNER accounts whose organization onboarding is not yet completed
 * onto the dedicated `/admin/onboarding` page, and keeps everyone else out of
 * it. The validated flag is `organizations.onboarding` (the account/owner
 * flag), never `stores.onboarding`.
 *
 * Pure and side-effect free: returns `true` when the route may activate, or a
 * `UrlTree` redirect otherwise (no navigation is triggered imperatively).
 */
export const onboardingGuard: CanActivateFn = (
  _route,
  state,
): boolean | UrlTree => {
  const auth = inject(AuthFacade);
  const router = inject(Router);

  const isOwner = auth.hasAnyRole(['owner', 'OWNER']);
  const done = auth.getCurrentUser()?.organizations?.onboarding === true;
  const onOnb = state.url.includes('/admin/onboarding');

  // Non-owners, and owners who already finished onboarding, must never see the
  // onboarding page. Bounce them to the dashboard if they land on it; allow
  // any other admin route through.
  if (!isOwner || done) {
    return onOnb ? router.parseUrl('/admin/dashboard') : true;
  }

  // Owner with pending onboarding: allow the onboarding page and force every
  // other admin route onto it.
  return onOnb ? true : router.parseUrl('/admin/onboarding');
};
