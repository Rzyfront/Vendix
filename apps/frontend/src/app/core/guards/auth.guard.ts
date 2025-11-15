import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private router = inject(Router);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> {
    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap((isAuthenticated) => {
        if (!isAuthenticated) {
          return of(
            this.router.createUrlTree(['/auth/login'], {
              queryParams: { returnUrl: state.url },
            }),
          );
        }
        // Si está autenticado, permitir acceso
        return of(true);
      }),
      catchError((error) => {
        console.error('[AUTH GUARD] Error in auth guard:', error);
        return of(this.router.createUrlTree(['/auth/login']));
      }),
    );
  }

  private redirectToLogin(returnUrl: string): Observable<UrlTree> {
    // Siempre redirigir al login contextual unificado
    const loginPath = '/auth/login';

    // Agregar parámetro de retorno si no es la página de login
    const navigationExtras =
      returnUrl !== '/auth/login' ? { queryParams: { returnUrl } } : {};

    return of(this.router.createUrlTree([loginPath], navigationExtras));
  }

  private checkBasicRoutePermissions(
    routePath: string,
    userRoles: string[],
  ): boolean {
    // Rutas de super admin solo para super_admin
    if (
      routePath.startsWith('/superadmin') &&
      !userRoles.includes('super_admin')
    ) {
      return false;
    }

    // Rutas de admin para roles administrativos
    if (routePath.startsWith('/admin')) {
      const adminRoles = ['super_admin', 'admin', 'owner', 'manager'];
      if (!userRoles.some((role) => adminRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de tienda para empleados y supervisores
    if (routePath.startsWith('/store')) {
      const storeRoles = ['supervisor', 'employee'];
      if (!userRoles.some((role) => storeRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de cuenta de cliente para clientes
    if (routePath.startsWith('/account')) {
      if (!userRoles.includes('customer')) {
        return false;
      }
    }

    return true;
  }
}
