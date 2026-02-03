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
import { SessionService } from '../services/session.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private sessionService = inject(SessionService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> {
    const path = state.url;

    // Si la sesión se está terminando, permitir navegación sin restricciones
    // para que el usuario pueda ser redirigido limpiamente
    if (this.sessionService.isTerminating()) {
      console.log('[AUTH GUARD] Session terminating, allowing navigation');
      return of(true);
    }

    console.log('[AUTH GUARD] canActivate() START', { path });

    // 1. Check if route is public (no auth required)
    if (this.isPublicRoute(path)) {
      return of(true);
    }

    // 2. Check localStorage flag first for immediate logout detection
    if (this.wasRecentlyLoggedOut()) {
      console.log('[AUTH GUARD] Recently logged out, redirecting');
      // Solo mostrar toast si NO estamos en proceso de logout
      if (!this.sessionService.shouldSuppressNotifications()) {
        this.toastService.warning(
          'Debes iniciar sesión para acceder a esta página',
        );
      }
      return of(this.router.createUrlTree(['/auth/login']));
    }

    // 3. Check if authenticated
    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap((isAuthenticated) => {
        if (!isAuthenticated) {
          console.log('[AUTH GUARD] Not authenticated, redirecting');
          // Solo mostrar toast si NO estamos en proceso de logout
          if (!this.sessionService.shouldSuppressNotifications()) {
            this.toastService.warning(
              'Debes iniciar sesión para acceder a esta página',
            );
          }
          return of(this.router.createUrlTree(['/auth/login']));
        }

        // 4. Check role-based permissions
        const hasPermission = this.hasRolePermission(path);
        if (!hasPermission) {
          console.log('[AUTH GUARD] No role permission, redirecting');
          // Solo mostrar toast si NO estamos en proceso de logout
          if (!this.sessionService.shouldSuppressNotifications()) {
            this.toastService.error(
              'No tienes permisos para acceder a esta página',
            );
          }
          return of(this.getDashboardUrl());
        }

        return of(true);
      }),
      catchError((error) => {
        console.error('[AUTH GUARD] Error:', error);
        // Solo mostrar toast si NO estamos en proceso de logout
        if (!this.sessionService.shouldSuppressNotifications()) {
          this.toastService.error('Error verificando autenticación');
        }
        return of(this.router.createUrlTree(['/']));
      }),
    );
  }

  /**
   * Check if a route is public (doesn't require authentication)
   */
  private isPublicRoute(path: string): boolean {
    // Rutas exactas que son públicas
    const exactPublicRoutes = ['/', ''];
    if (exactPublicRoutes.includes(path)) {
      return true;
    }

    // Prefijos de rutas públicas
    const publicPrefixes = [
      '/auth/', // Todas las rutas de autenticación
      '/landing', // Landing pages
      '/home', // Home público
      '/catalog', // Catálogo público
      '/product/', // Detalle de producto
      '/cart', // Carrito
      '/checkout', // Checkout
    ];

    return publicPrefixes.some((prefix) => path.startsWith(prefix));
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

    console.log('🎯 [AUTH GUARD] getDashboardUrl() - Roles:', userRoles);

    if (userRoles.includes('super_admin')) {
      console.log('✅ [AUTH GUARD] Redirecting to /superadmin/dashboard');
      return this.router.createUrlTree(['/superadmin/dashboard']);
    }

    if (userRoles.some((r) => ['admin', 'owner', 'manager'].includes(r))) {
      console.log('✅ [AUTH GUARD] Redirecting to /admin/dashboard');
      return this.router.createUrlTree(['/admin/dashboard']);
    }

    if (userRoles.some((r) => ['supervisor', 'employee'].includes(r))) {
      console.log('✅ [AUTH GUARD] Redirecting to /admin/dashboard');
      return this.router.createUrlTree(['/admin/dashboard']);
    }

    // Default fallback
    console.log('⚠️ [AUTH GUARD] No valid roles, redirecting to / (landing)');
    return this.router.createUrlTree(['/']);
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
}
