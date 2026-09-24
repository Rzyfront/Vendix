import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';
import {
  MenuFilterService,
  PANEL_UI_NO_ACCESS_ROUTE,
} from '../services/menu-filter.service';
import {
  canUserAccessDashboard,
  DASHBOARD_TRUSTED_ROLES,
  DASHBOARD_REQUIRED_PERMISSIONS,
} from '../utils/dashboard-access.util';

// Re-export for backward compatibility
export {
  canUserAccessDashboard,
  DASHBOARD_TRUSTED_ROLES as TRUSTED_ROLES,
  DASHBOARD_REQUIRED_PERMISSIONS as REQUIRED_PERMISSIONS,
};

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

  if (canUserAccessDashboard(authFacade)) {
    return true;
  }

  toast.info('No tienes permisos para acceder al Panel Principal.');

  const menuTree = menuFilter.currentMenuTree();
  const target = menuFilter.firstActiveModuleRoute(menuTree);
  // QUI-860: Evita la pantalla en blanco cuando no hay a dónde redirigir o target
  // cae en el mismo dashboard: navegar a /admin/no-access en vez de retornar false en el vacío.
  if (!target || target === '/admin/dashboard') {
    router.navigateByUrl(PANEL_UI_NO_ACCESS_ROUTE);
    return false;
  }

  router.navigateByUrl(target);
  return false;
};

