import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Gates the "Agentes IA" page (settings/ai-agents) by the LOGGED-IN user's
 * role.
 *
 * Mirrors `manage-users.guard.ts`. Deliberately role-only and narrower than
 * most settings pages: these switches hand agents that write to the store's
 * own data to every user of the store, so a cashier with a broad
 * `store:settings:update` permission must not be able to flip them. Only owner
 * and admin qualify — the same pair the agent controllers enforce with
 * `@Roles(OWNER, ADMIN)`.
 */
const TRUSTED_ROLES = ['owner', 'admin', 'STORE_OWNER', 'ORG_OWNER'];

const DENIED_MESSAGE =
  'Solo el propietario o un administrador puede configurar los agentes de IA.';

export const aiAgentsSettingsGuard: CanActivateFn = () => {
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

/**
 * Backwards-compatible alias from when the page was Vexi-only. New code
 * imports `aiAgentsSettingsGuard`.
 *
 * @deprecated Use `aiAgentsSettingsGuard`.
 */
export const vexiSettingsGuard: CanActivateFn = aiAgentsSettingsGuard;
