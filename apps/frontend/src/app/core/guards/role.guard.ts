import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';

export interface RoleGuardConfig {
  roles?: string[];
  permissions?: string[];
  anyRole?: boolean;
  anyPermission?: boolean;
  redirectTo?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private toast = inject(ToastService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> {
    const config = this.getGuardConfig(route);

    console.log('[ROLE GUARD] Checking permissions for route:', {
      path: route.routeConfig?.path,
      url: state.url,
      config,
      data: route.data
    });

    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap(isAuthenticated => {
        if (!isAuthenticated) {
          console.log('[ROLE GUARD] User not authenticated, redirecting to login');
          return this.redirectToLogin(state.url);
        }
        // Verificar roles
        return this.authFacade.userRoles$.pipe(
          take(1),
          map(userRoles => {
            const hasRequiredRole = config.roles!.length === 0 || userRoles.some(r => config.roles!.includes(r));
            if (hasRequiredRole) {
              console.log('[ROLE GUARD] Permission granted for route');
              return true;
            }
            this.toast.error('No tienes acceso a esta sección.');
            return false;
          })
        );
      }),
      catchError(error => {
        console.error('[ROLE GUARD] Error checking authentication:', error);
        return of(this.router.createUrlTree(['/auth/login']));
      })
    );
  }

  /**
   * Obtiene la configuración del guard desde la ruta
   */
  private getGuardConfig(route: ActivatedRouteSnapshot): RoleGuardConfig {
    const data = route.data;
    
    return {
      roles: data['roles'] || data['allowedRoles'] || [],
      permissions: data['permissions'] || data['allowedPermissions'] || [],
      anyRole: data['anyRole'] !== undefined ? data['anyRole'] : true,
      anyPermission: data['anyPermission'] !== undefined ? data['anyPermission'] : true,
      redirectTo: data['redirectTo'] || '/access-denied'
    };
  }

  /**
   * Redirige al login apropiado
   */
  private redirectToLogin(returnUrl: string): Observable<UrlTree> {
    const loginPath = '/auth/login';
    const navigationExtras = returnUrl !== '/auth/login' ? { queryParams: { returnUrl } } : {};
    return of(this.router.createUrlTree([loginPath], navigationExtras));
  }
}