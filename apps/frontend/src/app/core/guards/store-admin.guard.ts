import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { EnvironmentContextService } from '../services/environment-context.service';
import { AppEnvironment } from '../models/domain-config.interface';
import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class StoreAdminGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private environmentContextService = inject(EnvironmentContextService);
  private router = inject(Router);

  async canActivate(): Promise<boolean> {
    try {
      // Verificar que el usuario está autenticado
      const isAuthenticated =
        (await this.authFacade.isAuthenticated$.pipe(take(1)).toPromise()) ||
        false;
      if (!isAuthenticated) {
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar que estamos en el entorno correcto
      const currentEnv = this.environmentContextService.getCurrentEnvironment();
      if (currentEnv !== AppEnvironment.STORE_ADMIN) {
        console.warn('Access denied: Not in store environment', { currentEnv });
        this.router.navigate(['/auth/login']);
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
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar que tenemos el contexto de tienda
      const context = this.environmentContextService.getEnvironmentInfo();
      if (!context.store) {
        console.warn('Access denied: No store context available');
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar consistencia del entorno
      const isConsistent =
        this.environmentContextService.validateEnvironmentConsistency();
      if (!isConsistent) {
        console.warn(
          'Environment inconsistency detected, redirecting to login',
        );
        this.router.navigate(['/auth/login']);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in StoreAdminGuard:', error);
      this.router.navigate(['/auth/login']);
      return false;
    }
  }
}
