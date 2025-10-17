import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { AccessService } from '../services/access.service';

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
  private accessService = inject(AccessService);
  private router = inject(Router);

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

    return this.accessService.isAuthenticated().pipe(
      switchMap(isAuthenticated => {
        if (!isAuthenticated) {
          console.log('[ROLE GUARD] User not authenticated, redirecting to login');
          return this.redirectToLogin(state.url);
        }
        // Verificar roles
        return this.accessService.hasRole(config.roles ?? []).pipe(
          map(hasRole => {
            if (hasRole) {
              console.log('[ROLE GUARD] Permission granted for route');
              return true;
            }
            // Usuario autenticado pero sin rol: solo toast, no redirigir
            this.accessService['toast'].error('No tienes acceso a esta sección.');
            return false;
          }),
          catchError(error => {
            console.error('[ROLE GUARD] Error checking roles:', error);
            return of(false);
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