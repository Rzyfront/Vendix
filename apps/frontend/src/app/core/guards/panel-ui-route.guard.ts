import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Route-level defense-in-depth for `panel_ui` module visibility.
 *
 * `MenuFilterService` already hides the corresponding sidebar item when
 * `panel_ui[<app_type>][<key>] === false`, but that filter is **purely
 * visual**: a user can still type the URL directly and the
 * `DashboardComponent` (or any other module) loads. The `AuthGuard` only
 * validates JWT + non-`customer` role for `/admin/...` routes, so a
 * restricted employee bypasses the menu filter and reaches the page.
 *
 * This guard closes that bypass. It reads the same `visibleModules`
 * signal consumed by the sidebar and rejects navigation when the module
 * key is not present. Configure per-route via:
 *
 *   {
 *     path: 'dashboard',
 *     canActivate: [panelUiRouteGuard],
 *     data: { panelUiKey: 'dashboard' },
 *     loadComponent: () => ...
 *   }
 *
 * If a route has no `data.panelUiKey`, the guard is a no-op (it does not
 * restrict anything). That keeps it safe to apply selectively while
 * expanding coverage route-by-route.
 *
 * Note on stale state: when an OWNER disables a module for a currently
 * logged-in employee, the employee's NgRx state still holds the old
 * `panel_ui` until they re-login. This guard blocks the bypass for
 * fresh sessions and for the OWNER editing themselves (the user-config
 * modal already syncs `authFacade.updateUserSettings` in-memory on
 * success). Real-time push to other live sessions is out of scope.
 */
export const panelUiRouteGuard: CanActivateFn = (
  route,
  _state,
): boolean | UrlTree => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toastService = inject(ToastService);

  const panelUiKey = route.data?.['panelUiKey'] as string | undefined;
  if (!panelUiKey) {
    // No key configured on this route → guard is a no-op.
    return true;
  }

  if (authFacade.isModuleVisible(panelUiKey)) {
    return true;
  }

  // Blocked: notify and redirect to a safe public route. We use `/`
  // (landing) because:
  //  - it is whitelisted in `AuthGuard.isPublicRoute` (no auth loop),
  //  - it does not depend on any panel_ui key, so no recursion, and
  //  - it gives the user a clear signal that the requested page is
  //    not available without exposing other restricted modules.
  toastService.warning('No tienes acceso a este módulo');
  return router.createUrlTree(['/']);
};
