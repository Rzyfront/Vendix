import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';
import { MenuFilterService } from '../services/menu-filter.service';

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
 * passes; everyone else is redirected to the first active module (A.4)
 * with an info toast.
 *
 * A.4: the hardcoded `/admin/pos` was replaced by `firstActiveModuleRoute()`,
 * which respects the sidebar's panel_ui (a user bounced here by permissions
 * whose POS is hidden is re-routed to whatever module IS active instead of
 * being caught by the panelUiGuard into a second, contradictory redirect).
 */
export const storeDashboardGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);
  const menuFilter = inject(MenuFilterService);

  if (
    authFacade.isOwner() ||
    authFacade.isAdmin() ||
    authFacade.hasAnyRole(TRUSTED_ROLES) ||
    authFacade.hasAnyPermission(REQUIRED_PERMISSIONS)
  ) {
    return true;
  }

  toast.info('No tienes permisos para acceder al Panel Principal.');

  const menuTree = menuFilter.currentMenuTree();
  const target = menuFilter.firstActiveModuleRoute(menuTree);
  // Evita el bucle cuando el primer módulo "activo" es este mismo dashboard
  // (panel_ui lo muestra pero al usuario le faltó el permiso): no hay a dónde
  // redirigir, se bloquea y el toast explica.
  if (target === '/admin/dashboard') return false;

  router.navigateByUrl(target);
  return false;
};
