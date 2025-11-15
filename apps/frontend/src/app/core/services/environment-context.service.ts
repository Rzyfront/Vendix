import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { GlobalFacade } from '../store/global.facade';
import { AppEnvironment } from '../models/domain-config.interface';

export interface EnvironmentContext {
  currentEnvironment: AppEnvironment;
  userRoles: string[];
  userPermissions: string[];
  organizationSlug?: string;
  storeSlug?: string;
  canSwitchToOrganization: boolean;
  canSwitchToStore: boolean;
  availableStores: any[];
}

@Injectable({
  providedIn: 'root',
})
export class EnvironmentContextService {
  private authFacade = inject(AuthFacade);
  private globalFacade = inject(GlobalFacade);

  /**
   * Obtiene el contexto completo del entorno actual
   */
  getCurrentEnvironmentContext(): Observable<EnvironmentContext> {
    return this.authFacade.user$.pipe(
      take(1),
      map((user) => {
        const userRoles = user?.roles || [];
        const userPermissions = user?.permissions || [];
        const currentEnvironment = this.getCurrentEnvironmentFromUser(user);

        return {
          currentEnvironment,
          userRoles,
          userPermissions,
          organizationSlug: user?.organization?.slug,
          storeSlug: user?.store?.slug,
          canSwitchToOrganization: this.canSwitchToOrganization(user),
          canSwitchToStore: this.canSwitchToStore(user),
          availableStores: user?.stores || [],
        };
      }),
    );
  }

  /**
   * Verifica si el usuario puede cambiar al entorno de organización
   */
  canSwitchToOrganization(user?: any): boolean {
    const currentUser = user || this.getCurrentUser();
    if (!currentUser) return false;

    const hasStoreRole = currentUser.roles?.some((role: string) => 
      ['store_admin', 'owner', 'manager'].includes(role)
    );
    const hasOrgRole = currentUser.roles?.some((role: string) => 
      ['org_admin', 'owner', 'super_admin'].includes(role)
    );

    // Verificar si está actualmente en entorno de store
    const currentEnv = this.getCurrentEnvironment();
    const isInStoreEnvironment = currentEnv === AppEnvironment.STORE_ADMIN;

    // Para cambiar a organización, debe:
    // 1. Tener roles de ambos entornos
    // 2. Estar actualmente en entorno de store
    // 3. Tener acceso a organización (verificado por roles)
    return hasStoreRole && hasOrgRole && isInStoreEnvironment;
  }

  /**
   * Verifica si el usuario puede cambiar al entorno de tienda
   */
  canSwitchToStore(user?: any): boolean {
    const currentUser = user || this.getCurrentUser();
    if (!currentUser) return false;

    const hasOrgRole = currentUser.roles?.some((role: string) =>
      ['org_admin', 'owner', 'super_admin'].includes(role),
    );
    const hasStoreRole = currentUser.roles?.some((role: string) =>
      ['store_admin', 'owner', 'manager'].includes(role),
    );

    return hasOrgRole && hasStoreRole && currentUser.organization;
  }

  /**
   * Obtiene el entorno actual del usuario
   */
  getCurrentEnvironment(): AppEnvironment {
    const user = this.getCurrentUser();
    return this.getCurrentEnvironmentFromUser(user);
  }

  /**
   * Verifica si el usuario está en entorno de organización
   */
  isInOrganizationEnvironment(): boolean {
    const env = this.getCurrentEnvironment();
    return env === AppEnvironment.ORG_ADMIN;
  }

  /**
   * Verifica si el usuario está en entorno de tienda
   */
  isInStoreEnvironment(): boolean {
    const env = this.getCurrentEnvironment();
    return env === AppEnvironment.STORE_ADMIN;
  }

  /**
   * Obtiene información del entorno actual de forma síncrona
   */
  getEnvironmentInfo() {
    const user = this.getCurrentUser();
    const context = this.globalFacade.getUserContext();

    return {
      environment: this.getCurrentEnvironmentFromUser(user),
      user,
      organization: context?.organization,
      store: context?.store,
      roles: user?.roles || [],
      permissions: user?.permissions || [],
    };
  }

  /**
   * Limpia el contexto del entorno (usado durante logout)
   */
  clearEnvironmentContext(): void {
    try {
      localStorage.removeItem('vendix_user_environment');
      localStorage.removeItem('vendix_auth_state');
    } catch (error) {
      console.warn('Error clearing environment context:', error);
    }
  }

  /**
   * Valida la consistencia del entorno actual
   */
  validateEnvironmentConsistency(): boolean {
    try {
      const cachedEnv = localStorage.getItem('vendix_user_environment');
      const currentEnv = this.getCurrentEnvironment();

      if (cachedEnv && cachedEnv !== currentEnv) {
        console.warn('Environment inconsistency detected:', {
          cached: cachedEnv,
          current: currentEnv,
        });
        return false;
      }

      const authState = JSON.parse(
        localStorage.getItem('vendix_auth_state') || '{}',
      );
      if (authState.environment && authState.environment !== currentEnv) {
        console.warn('Auth state environment inconsistency:', {
          authState: authState.environment,
          current: currentEnv,
        });
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating environment consistency:', error);
      return false;
    }
  }

  // Métodos privados

  private getCurrentUser(): any {
    let user: any = null;
    this.authFacade.user$.pipe(take(1)).subscribe((u) => (user = u));
    return user;
  }

  private getCurrentEnvironmentFromUser(user: any): AppEnvironment {
    if (!user) return AppEnvironment.VENDIX_LANDING;

    // Prioridad 1: User settings config
    if (user.user_settings?.config?.app) {
      return user.user_settings.config.app as AppEnvironment;
    }

    // Prioridad 2: Contexto actual
    const context = this.globalFacade.getUserContext();
    if (context?.store) {
      return AppEnvironment.STORE_ADMIN;
    }
    if (context?.organization) {
      return AppEnvironment.ORG_ADMIN;
    }

    // Prioridad 3: Roles del usuario
    if (user.roles?.includes('super_admin')) {
      return AppEnvironment.VENDIX_ADMIN;
    }
    if (user.roles?.includes('org_admin') || user.roles?.includes('owner')) {
      return AppEnvironment.ORG_ADMIN;
    }
    if (
      user.roles?.includes('store_admin') ||
      user.roles?.includes('manager')
    ) {
      return AppEnvironment.STORE_ADMIN;
    }

    return AppEnvironment.VENDIX_LANDING;
  }
}
