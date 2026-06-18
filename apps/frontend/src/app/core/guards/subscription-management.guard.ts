import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

const TRUSTED_ROLES = [
  'owner',
  'OWNER',
  'super_admin',
  'STORE_OWNER',
  'ORG_OWNER',
];

const DENIED_MESSAGE = 'Solo el propietario puede gestionar la suscripción.';

export const subscriptionManagementGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (authFacade.isOwner() || authFacade.hasAnyRole(TRUSTED_ROLES)) {
    return true;
  }

  toast.info(DENIED_MESSAGE);
  router.navigateByUrl('/admin/dashboard');
  return false;
};
