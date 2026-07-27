import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

// Roles that always have dashboard access (regardless of granular permission).
const TRUSTED_ROLES = [
  'owner',
  'admin',
  'super_admin',
  'STORE_OWNER',
  'ORG_OWNER',
  'manager',
];

// Permission codes that unlock the dashboard. Try the canonical one first,
// fall back to analytics-read since the dashboard depends on those endpoints.
const REQUIRED_PERMISSIONS = [
  'store:dashboard:view',
  'store:analytics:read',
];

/**
 * CanActivate for `/admin/dashboard`.
 *
 * QUI-418: The auth guard at the `admin` parent only checks
 * `!roles.includes('customer')` and delegates granular permissions to the
 * `panel_ui` sidebar. That left URL-direct navigation (`/admin/dashboard`)
 * accessible to any non-customer user — owner-restricted employees could
 * reach the dashboard. This guard closes that bypass: an OWNER/admin/
 * manager OR a user with at least one of the dashboard permissions
 * passes; everyone else is redirected to `/admin/pos` with an info toast.
 */
export const storeDashboardGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (
    authFacade.isOwner() ||
    authFacade.isAdmin() ||
    authFacade.hasAnyRole(TRUSTED_ROLES) ||
    authFacade.hasAnyPermission(REQUIRED_PERMISSIONS)
  ) {
    return true;
  }

  toast.info('No tienes permisos para acceder al Panel Principal.');
  router.navigateByUrl('/admin/pos');
  return false;
};
