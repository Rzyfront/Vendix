import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private router = inject(Router);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    
    console.log('[AUTH GUARD] Checking authentication for route:', {
      path: route.routeConfig?.path,
      url: state.url,
      data: route.data
    });

    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap(isAuthenticated => {
        if (!isAuthenticated) {
          console.log('[AUTH GUARD] User not authenticated, redirecting to login');
          return this.redirectToLogin(state.url);
        }

        // Usuario autenticado, verificar permisos básicos
        const user = this.authFacade.getCurrentUser();
        const userRoles = user?.roles || [];
        
        // Verificar permisos básicos para la ruta
        const routeAllowed = this.checkBasicRoutePermissions(state.url, userRoles);
        
        if (!routeAllowed) {
          console.warn('[AUTH GUARD] Route not allowed for user:', {
            route: state.url,
            userRoles
          });
          return of(this.router.createUrlTree(['/access-denied']));
        }

        console.log('[AUTH GUARD] Route allowed, proceeding');
        return of(true);
      }),
      catchError(error => {
        console.error('[AUTH GUARD] Error checking authentication:', error);
        return of(this.router.createUrlTree(['/auth/login']));
      })
    );
  }

  private redirectToLogin(returnUrl: string): Observable<UrlTree> {
    // Siempre redirigir al login contextual unificado
    const loginPath = '/auth/login';
    
    // Agregar parámetro de retorno si no es la página de login
    const navigationExtras = returnUrl !== '/auth/login' ? { queryParams: { returnUrl } } : {};
    
    return of(this.router.createUrlTree([loginPath], navigationExtras));
  }

  private checkBasicRoutePermissions(routePath: string, userRoles: string[]): boolean {
    // Rutas de super admin solo para super_admin
    if (routePath.startsWith('/superadmin') && !userRoles.includes('super_admin')) {
      return false;
    }

    // Rutas de admin para roles administrativos
    if (routePath.startsWith('/admin')) {
      const adminRoles = ['super_admin', 'admin', 'owner', 'manager'];
      if (!userRoles.some(role => adminRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de POS para empleados y supervisores
    if (routePath.startsWith('/pos')) {
      const posRoles = ['supervisor', 'employee'];
      if (!userRoles.some(role => posRoles.includes(role))) {
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