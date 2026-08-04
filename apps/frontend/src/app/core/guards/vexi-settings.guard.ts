import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Gates the Vexi master switch (settings/vexi) by the LOGGED-IN user's role.
 *
 * Mirrors `manage-users.guard.ts`. Deliberately role-only and narrower than
 * most settings pages: this switch removes the assistant for every user of the
 * store, so a cashier with a broad `store:settings:update` permission must not
 * be able to flip it. Only owner and admin qualify — the same pair
 * `VexiController` enforces with `@Roles(OWNER, ADMIN)`.
 */
const TRUSTED_ROLES = ['owner', 'admin', 'STORE_OWNER', 'ORG_OWNER'];

const DENIED_MESSAGE =
  'Solo el propietario o un administrador puede configurar a Vexi.';

export const vexiSettingsGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (
    authFacade.isOwner() ||
    authFacade.isAdmin() ||
    authFacade.hasAnyRole(TRUSTED_ROLES)
  ) {
    return true;
  }

  toast.info(DENIED_MESSAGE);
  router.navigateByUrl('/admin/settings/general');
  return false;
};
