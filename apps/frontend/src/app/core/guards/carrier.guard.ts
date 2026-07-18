import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Carrier delivery gate (Vendix Repartos, app_type STORE_DELIVERY).
 *
 * Punto de restricción PRINCIPAL de la app interna de reparto: solo permite
 * activar rutas `/repartos/*` a usuarios con el rol `carrier`. `AuthGuard`
 * (hasRolePermission + getDashboardUrl) actúa como defensa en profundidad.
 *
 * Puro y sin efectos imperativos: devuelve `true` cuando la ruta puede
 * activarse, o un `UrlTree` de redirección a `/auth/login` en caso contrario
 * (el toast es un aviso lateral, no dispara navegación).
 */
export const carrierGuard: CanActivateFn = (): boolean | UrlTree => {
  const authFacade = inject(AuthFacade);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (authFacade.isCarrier()) {
    return true;
  }

  toast.error('No tienes permisos para acceder a Vendix Repartos');
  return router.createUrlTree(['/auth/login']);
};
