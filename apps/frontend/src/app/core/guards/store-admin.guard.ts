import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { EnvironmentContextService } from '../services/environment-context.service';
import { AppEnvironment } from '../models/domain-config.interface';
import { take } from 'rxjs/operators';
import { ToastService } from '../../shared/components/toast/toast.service';

@Injectable({
  providedIn: 'root',
})
export class StoreAdminGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private environmentContextService = inject(EnvironmentContextService);
  private router = inject(Router);
  private toastService = inject(ToastService);

  async canActivate(): Promise<boolean> {
    try {
      // Check localStorage flag first for immediate logout detection
      if (this.wasRecentlyLoggedOut()) {
        this.toastService.warning('No tienes permisos para ver esa ruta');
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar que el usuario está autenticado
      const isAuthenticated =
        (await this.authFacade.isAuthenticated$.pipe(take(1)).toPromise()) ||
        false;
      if (!isAuthenticated) {
        this.toastService.warning('No tienes permisos para ver esa ruta');
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar que estamos en el entorno correcto
      const currentEnv = this.environmentContextService.getCurrentEnvironment();
      if (currentEnv !== AppEnvironment.STORE_ADMIN) {
        console.warn('Access denied: Not in store environment', { currentEnv });
        this.toastService.warning('No tienes permisos para ver esa ruta');
        this.router.navigate(['/']);
        return false;
      }

      // Verificar roles de tienda
      const user =
        (await this.authFacade.user$.pipe(take(1)).toPromise()) || null;
      const hasStoreRole = user?.roles?.some((role: string) =>
        ['store_admin', 'owner', 'manager'].includes(role),
      );

      if (!hasStoreRole) {
        console.warn('Access denied: Insufficient store permissions', {
          roles: user?.roles,
        });
        this.toastService.warning('No tienes permisos para ver esa ruta');
        this.router.navigate(['/']);
        return false;
      }

      // Verificar que tenemos el contexto de tienda
      const context = this.environmentContextService.getEnvironmentInfo();
      if (!context.store) {
        console.warn('Access denied: No store context available');
        this.toastService.warning('Error de contexto de tienda');
        this.router.navigate(['/']);
        return false;
      }

      // Verificar consistencia del entorno
      const isConsistent =
        this.environmentContextService.validateEnvironmentConsistency();
      if (!isConsistent) {
        console.warn('Environment inconsistency detected, redirecting to home');
        this.toastService.warning('Error de entorno');
        this.router.navigate(['/']);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in StoreAdminGuard:', error);
      this.toastService.error('Error verificando permisos');
      this.router.navigate(['/auth/login']);
      return false;
    }
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
