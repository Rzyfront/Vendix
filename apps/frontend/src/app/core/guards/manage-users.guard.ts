import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Gates the store users management surface (settings/users) by the
 * LOGGED-IN user's authorization. Mirrors the functional-guard pattern of
 * `fiscal-management.guard.ts`: allow when the user has the named permission
 * OR an owner/admin role; otherwise toast + redirect.
 *
 * Prefers the named permission `store:users:update`, falling back to the
 * owner/admin roles. This keeps visibility (panel_ui) separate from real
 * authorization (see `vendix-permissions`).
 */
const REQUIRED_PERMISSIONS = ['store:users:update'];

const TRUSTED_ROLES = ['owner', 'admin', 'super_admin', 'STORE_OWNER', 'ORG_OWNER'];

const DENIED_MESSAGE = 'No tienes permisos para gestionar usuarios de la tienda.';

export const manageUsersGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (
    authFacade.hasAnyRole(TRUSTED_ROLES) ||
    authFacade.hasAnyPermission(REQUIRED_PERMISSIONS) ||
    authFacade.isOwner() ||
    authFacade.isAdmin()
  ) {
    return true;
  }

  toast.info(DENIED_MESSAGE);
  router.navigateByUrl('/admin/dashboard');
  return false;
};
