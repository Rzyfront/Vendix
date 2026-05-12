import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';
import type { OrganizationOperatingScope } from '../models/organization.model';

const LOCKED_REDIRECT_ROUTE = '/admin/stores';
const DEFAULT_LOCKED_TOAST_MESSAGE =
  'Selecciona una tienda para administrar inventario en modo STORE.';

export const operatingScopeGuard: CanActivateFn = (route) => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toastService = inject(ToastService);

  const required = route.data?.['requiredOperatingScope'] as
    | OrganizationOperatingScope
    | undefined;

  if (!required) {
    return true;
  }

  const current = authFacade.operatingScope();
  if (current === required) {
    return true;
  }

  const message =
    (route.data?.['lockedTooltip'] as string | undefined) ||
    DEFAULT_LOCKED_TOAST_MESSAGE;
  toastService.info(message);
  router.navigateByUrl(LOCKED_REDIRECT_ROUTE);
  return false;
};
