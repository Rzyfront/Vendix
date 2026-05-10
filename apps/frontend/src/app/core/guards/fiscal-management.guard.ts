import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

const REQUIRED_PERMISSIONS = [
  'store:settings:fiscal_status:write',
  'organization:settings:fiscal_status:write',
];

const DENIED_MESSAGE =
  'Solicita al propietario activar el manejo fiscal en la organización.';

export const fiscalManagementGuard: CanActivateFn = () => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (authFacade.hasAnyPermission(REQUIRED_PERMISSIONS)) {
    return true;
  }

  toast.info(DENIED_MESSAGE);
  router.navigateByUrl('/admin/settings/fiscal');
  return false;
};
