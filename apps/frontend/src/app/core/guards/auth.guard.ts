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
import { ToastService } from '../../shared/components/toast/toast.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private toastService = inject(ToastService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> {
    // Check localStorage flag first for immediate logout detection
    if (this.wasRecentlyLoggedOut()) {
      this.toastService.warning('No tienes permisos para ver esa ruta');
      return of(this.router.createUrlTree(['/auth/login']));
    }

    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap((isAuthenticated) => {
        if (!isAuthenticated) {
          this.toastService.warning('No tienes permisos para ver esa ruta');
          return of(this.router.createUrlTree(['/auth/login']));
        }
        // Si está autenticado, permitir acceso
        return of(true);
      }),
      catchError((error) => {
        console.error('[AUTH GUARD] Error in auth guard:', error);
        this.toastService.error('Error verificando permisos');
        return of(this.router.createUrlTree(['/auth/login']));
      }),
    );
  }

  /**
   * Check if the user was recently logged out to prevent stale state navigation
   */
  private wasRecentlyLoggedOut(): boolean {
    if (typeof localStorage === 'undefined') return false;

    const loggedOutRecently = localStorage.getItem(
      'vendix_logged_out_recently',
    );
    if (loggedOutRecently) {
      const logoutTime = parseInt(loggedOutRecently, 10);
      const currentTime = Date.now();
      // Consider "recently logged out" within 5 minutes
      if (currentTime - logoutTime < 5 * 60 * 1000) {
        return true;
      }
    }
    return false;
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
