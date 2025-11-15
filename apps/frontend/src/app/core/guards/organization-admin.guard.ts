import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { EnvironmentContextService } from '../services/environment-context.service';
import { AppEnvironment } from '../models/domain-config.interface';
import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class OrganizationAdminGuard implements CanActivate {
  private authFacade = inject(AuthFacade);
  private environmentContextService = inject(EnvironmentContextService);
  private router = inject(Router);

  async canActivate(): Promise<boolean> {
    try {
      // Verificar que el usuario está autenticado
      const isAuthenticated = await this.authFacade.isAuthenticated$
        .pipe(take(1))
        .toPromise();
      if (!isAuthenticated) {
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar que estamos en el entorno correcto
      const currentEnv = this.environmentContextService.getCurrentEnvironment();
      if (currentEnv !== AppEnvironment.ORG_ADMIN) {
        console.warn('Access denied: Not in organization environment', {
          currentEnv,
        });
        this.router.navigate(['/auth/login']);
        return false;
      }

      // Verificar roles de organización
      const user = await this.authFacade.user$.pipe(take(1)).toPromise();
      const hasOrgRole = user?.roles?.some((role: string) =>
        ['org_admin', 'owner', 'super_admin'].includes(role),
      );

      if (!hasOrgRole) {
        console.warn('Access denied: Insufficient organization permissions', {
          roles: user?.roles,
        });
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
      console.error('Error in OrganizationAdminGuard:', error);
      this.router.navigate(['/auth/login']);
      return false;
    }
  }
}
