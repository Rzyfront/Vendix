import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';

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

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    
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

        // Verificar permisos basados en la configuración
        return this.checkPermissions(config).pipe(
          map(hasPermission => {
            if (hasPermission) {
              console.log('[ROLE GUARD] Permission granted for route');
              return true;
            }

            console.warn('[ROLE GUARD] Permission denied for route:', {
              route: state.url,
              user: this.authFacade.getCurrentUser(),
              config
            });

            return this.handleAccessDenied(config);
          }),
          catchError(error => {
            console.error('[ROLE GUARD] Error checking permissions:', error);
            return of(this.handleAccessDenied(config));
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
   * Verifica los permisos basados en la configuración
   */
  private checkPermissions(config: RoleGuardConfig): Observable<boolean> {
    return this.authFacade.user$.pipe(
      take(1),
      switchMap(user => {
        if (!user) {
          return of(false);
        }

        // Verificar roles primero
        const hasRequiredRoles = this.checkRoles(config, user);
        const hasRequiredPermissions = this.checkPermissionsConfig(config, user);

        console.log('[ROLE GUARD] Permission check results:', {
          hasRequiredRoles,
          hasRequiredPermissions,
          userRoles: user.roles,
          userPermissions: user.permissions
        });

        // Lógica de verificación combinada
        if ((config.roles?.length ?? 0) > 0 && (config.permissions?.length ?? 0) > 0) {
          return of(hasRequiredRoles && hasRequiredPermissions);
        } else if ((config.roles?.length ?? 0) > 0) {
          return of(hasRequiredRoles);
        } else if ((config.permissions?.length ?? 0) > 0) {
          return of(hasRequiredPermissions);
        }

        // Si no hay configuración específica, permitir acceso
        return of(true);
      })
    );
  }

  /**
   * Verifica los roles requeridos
   */
  private checkRoles(config: RoleGuardConfig, user: any): boolean {
    if ((config.roles?.length ?? 0) === 0) {
      return true;
    }

    const userRoles = user.roles || [];
    
    if (config.anyRole) {
      // Verificar si tiene ALGUNO de los roles requeridos
      return config.roles!.some(requiredRole =>
        userRoles.includes(requiredRole)
      );
    } else {
      // Verificar si tiene TODOS los roles requeridos
      return config.roles!.every(requiredRole =>
        userRoles.includes(requiredRole)
      );
    }
  }

  /**
   * Verifica los permisos requeridos
   */
  private checkPermissionsConfig(config: RoleGuardConfig, user: any): boolean {
    if ((config.permissions?.length ?? 0) === 0) {
      return true;
    }

    const userPermissions = user.permissions || [];
    
    if (config.anyPermission) {
      // Verificar si tiene ALGUNO de los permisos requeridos
      return config.permissions!.some(requiredPermission =>
        userPermissions.includes(requiredPermission)
      );
    } else {
      // Verificar si tiene TODOS los permisos requeridos
      return config.permissions!.every(requiredPermission =>
        userPermissions.includes(requiredPermission)
      );
    }
  }

  /**
   * Maneja el acceso denegado
   */
  private handleAccessDenied(config: RoleGuardConfig): UrlTree {
    console.log('[ROLE GUARD] Access denied, redirecting to:', config.redirectTo);
    return this.router.createUrlTree([config.redirectTo]);
  }

  /**
   * Redirige al login apropiado
   */
  private redirectToLogin(returnUrl: string): Observable<UrlTree> {
    // Siempre redirigir al login contextual unificado
    const loginPath = '/auth/login';
    
    const navigationExtras = returnUrl !== '/auth/login' ? { queryParams: { returnUrl } } : {};
    
    return of(this.router.createUrlTree([loginPath], navigationExtras));
  }

  /**
   * API Pública para verificar permisos programáticamente
   */
  hasRequiredRoles(roles: string[], anyRole: boolean = true): Observable<boolean> {
    return this.authFacade.user$.pipe(
      take(1),
      map(user => {
        if (!user) return false;
        
        const userRoles = user.roles || [];
        
        if (anyRole) {
          return roles.some(role => userRoles.includes(role));
        } else {
          return roles.every(role => userRoles.includes(role));
        }
      })
    );
  }

  /**
   * API Pública para verificar permisos programáticamente
   */
  hasRequiredPermissions(permissions: string[], anyPermission: boolean = true): Observable<boolean> {
    return this.authFacade.user$.pipe(
      take(1),
      map(user => {
        if (!user) return false;
        
        const userPermissions = user.permissions || [];
        
        if (anyPermission) {
          return permissions.some(permission => userPermissions.includes(permission));
        } else {
          return permissions.every(permission => userPermissions.includes(permission));
        }
      })
    );
  }
}