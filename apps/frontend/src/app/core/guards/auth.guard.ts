import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
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

        // 4. Check role-based permissions
        if (!this.hasRolePermission(state.url)) {
          this.toastService.error(
            'No tienes permisos para acceder a esta página',
          );
          return of(this.getDashboardUrl());
        }

        // If authenticated and has permission, allow access
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
   * Check if the user was recently logged out via localStorage flag
   */
  private wasRecentlyLoggedOut(): boolean {
    return localStorage.getItem('logged_out') === 'true';
  }

  /**
   * Check if a route is public (doesn't require authentication)
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
    return of(this.router.createUrlTree([loginPath], { queryParams: { returnUrl } }));
  }

  private redirectToLogin(returnUrl: string): Observable<UrlTree> {
    // Siempre redirigir al login contextual unificado
    const loginPath = '/auth/login';
    return of(
      this.router.createUrlTree([loginPath], { queryParams: { returnUrl } }),
    );
  }

  /**
   * Check if the user has the required role for the route
   */
  private hasRolePermission(path: string): boolean {
    // Account routes - accessible to any authenticated user
    if (path.startsWith('/account')) {
      return true;
    }

    const userRoles = this.authFacade.getRoles();

    // Si no hay roles, denegar acceso a rutas protegidas
    if (!userRoles || userRoles.length === 0) {
      return false;
    }

    // Super admin routes - solo super_admin
    if (path.startsWith('/superadmin')) {
      return userRoles.includes('super_admin');
    }

    // Admin routes - roles administrativos de organización
    if (path.startsWith('/admin')) {
      const adminRoles = ['super_admin', 'admin', 'owner', 'manager'];
      return adminRoles.some((role) => userRoles.includes(role));
    }

    // Store routes - roles de tienda
    if (path.startsWith('/store')) {
      const storeRoles = [
        'super_admin',
        'admin',
        'owner',
        'manager',
        'supervisor',
        'employee',
      ];
      return storeRoles.some((role) => userRoles.includes(role));
    }

    // Por defecto, permitir si está autenticado
    return true;
  }

  /**
   * Get the appropriate dashboard URL based on user roles
   */
  private getDashboardUrl(): UrlTree {
    const userRoles = this.authFacade.getRoles();

    if (userRoles.includes('super_admin')) {
      return this.router.createUrlTree(['/superadmin/dashboard']);
    }

    if (userRoles.some((r) => ['admin', 'owner', 'manager'].includes(r))) {
      return this.router.createUrlTree(['/admin/dashboard']);
    }

    if (userRoles.some((r) => ['supervisor', 'employee'].includes(r))) {
      return this.router.createUrlTree(['/admin/dashboard']);
    }

    // Default fallback
    return this.router.createUrlTree(['/']);
  }
}
