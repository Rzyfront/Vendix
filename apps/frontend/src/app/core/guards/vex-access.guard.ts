import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { StoreSettingsFacade } from '../store/store-settings/store-settings.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Gates the Vex fullscreen view (`/admin/vex`) by role AND store toggle.
 *
 * Two conditions, both necessary:
 *
 * 1. Role owner/admin. Mirrors `aiAgentsSettingsGuard` exactly (role-only, no
 *    permission fallback): Vex writes across the whole store, so a broad
 *    `store:settings:update` must not buy access.
 * 2. `store_settings.settings.vex.enabled === true`, read through
 *    `StoreSettingsFacade.vexEnabled()`. Fails closed: an ABSENT block means
 *    OFF, same rule the backend `VexEnabledGuard` enforces. If this side were
 *    the more permissive of the two, the view would mount against endpoints
 *    that refuse it and read as broken rather than off.
 *
 * The plan gate (`vex_agent` feature) is enforced server-side by
 * `AiAccessGuard`; this guard deliberately does not duplicate it, so a stale
 * subscription snapshot never locks out a paying store at the route level.
 */
const TRUSTED_ROLES = ['owner', 'admin', 'STORE_OWNER', 'ORG_OWNER'];

const ROLE_DENIED_MESSAGE =
  'Solo el propietario o un administrador puede usar a Vex.';

const DISABLED_MESSAGE =
  'Vex está desactivado en esta tienda. Actívalo en Agentes IA para entrar.';

export const vexAccessGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const settingsFacade = inject(StoreSettingsFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (
    !(
      authFacade.isOwner() ||
      authFacade.isAdmin() ||
      authFacade.hasAnyRole(TRUSTED_ROLES)
    )
  ) {
    toast.info(ROLE_DENIED_MESSAGE);
    router.navigateByUrl('/admin');
    return false;
  }

  if (!settingsFacade.vexEnabled()) {
    toast.info(DISABLED_MESSAGE);
    router.navigateByUrl('/admin/settings/ai-agents?tab=vex');
    return false;
  }

  return true;
};
