import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  DomainConfig,
  AppEnvironment,
} from '../models/domain-config.interface';

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private router = inject(Router);

  /**
   * Redirección inteligente después del login basada en rol y contexto.
   * Ahora simplemente determina la ruta por defecto para el entorno del usuario.
   */
  redirectAfterLogin(userRoles: string[], domainConfig: DomainConfig): string {
    // La lógica compleja de resolución de layout ya no es necesaria.
    // Simplemente obtenemos la ruta por defecto para el entorno actual.
    return this.getDefaultRouteForEnvironment(domainConfig.environment);
  }

  /**
   * Obtiene la ruta por defecto para un entorno específico.
   */
  getDefaultRouteForEnvironment(environment: AppEnvironment): string {
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return '/';
      case AppEnvironment.VENDIX_ADMIN:
        return '/super-admin';
      case AppEnvironment.ORG_LANDING:
        return '/';
      case AppEnvironment.ORG_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ECOMMERCE:
        return '/shop';
      default:
        return '/';
    }
  }

  /**
   * Redirección para página no encontrada.
   */
  redirectToNotFound(): Promise<boolean> {
    return this.router.navigateByUrl('/not-found');
  }

  /**
   * Redirección al login contextual.
   */
  redirectToLogin(returnUrl?: string): Promise<boolean> {
    const queryParams = returnUrl ? { returnUrl } : {};
    return this.router.navigate(['/auth/login'], { queryParams });
  }
}
