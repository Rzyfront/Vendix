import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { take, map } from 'rxjs/operators';
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

  canSwitchToOrganization(user?: any): boolean {
    let currentUser = user || this.getCurrentUserFromAuth();

    if (!currentUser) {
      try {
        const authState = JSON.parse(
          localStorage.getItem('vendix_auth_state') || '{}',
        );
        currentUser = authState.user;
        console.log('🔍 canSwitchToOrganization: Using user from localStorage');
      } catch (error) {
        console.log(
          '🔍 canSwitchToOrganization: No user found in localStorage',
        );
        return false;
      }
    }

    if (!currentUser) {
      console.log('🔍 canSwitchToOrganization: No user found anywhere');
      return false;
    }

    const hasOrgRole = currentUser.roles?.some((role: string) =>
      ['org_admin', 'owner', 'super_admin'].includes(role),
    );

    const currentEnv = this.getCurrentEnvironmentFromUser(currentUser);
    const isInStoreEnvironment = currentEnv === AppEnvironment.STORE_ADMIN;

    console.log('🔍 canSwitchToOrganization debug:', {
      user: currentUser.email,
      roles: currentUser.roles,
      hasOrgRole,
      currentEnv,
      isInStoreEnvironment,
      canSwitch: hasOrgRole && isInStoreEnvironment,
    });

    return hasOrgRole && isInStoreEnvironment;
  }

  canSwitchToStore(user?: any): boolean {
    const currentUser = user || this.getCurrentUserFromAuth();
    if (!currentUser) return false;

    const hasOrgRole = currentUser.roles?.some((role: string) =>
      ['org_admin', 'owner', 'super_admin'].includes(role),
    );
    const hasStoreRole = currentUser.roles?.some((role: string) =>
      ['store_admin', 'owner', 'manager'].includes(role),
    );

    return hasOrgRole && hasStoreRole && currentUser.organization;
  }

  getCurrentEnvironment(): AppEnvironment {
    const user = this.getCurrentUserFromAuth();
    return this.getCurrentEnvironmentFromUser(user);
  }

  isInOrganizationEnvironment(): boolean {
    const env = this.getCurrentEnvironment();
    return env === AppEnvironment.ORG_ADMIN;
  }

  isInStoreEnvironment(): boolean {
    const env = this.getCurrentEnvironment();
    return env === AppEnvironment.STORE_ADMIN;
  }

  getEnvironmentInfo() {
    const user = this.getCurrentUserFromAuth();
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

  clearEnvironmentContext(): void {
    try {
      localStorage.removeItem('vendix_user_environment');
      localStorage.removeItem('vendix_auth_state');
    } catch (error) {
      console.warn('Error clearing environment context:', error);
    }
  }

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

  private getCurrentUserFromAuth(): any {
    let user: any = null;
    this.authFacade.user$.pipe(take(1)).subscribe((u) => (user = u));
    return user;
  }

  private getCurrentEnvironmentFromUser(user: any): AppEnvironment {
    if (!user) return AppEnvironment.VENDIX_LANDING;

    if (user.user_settings?.config?.app) {
      const env = user.user_settings.config.app as AppEnvironment;
      console.log('🔍 Environment from user settings:', env);
      return env;
    }

    const context = this.globalFacade.getUserContext();
    if (context?.store) {
      console.log(
        '🔍 Environment from context store:',
        AppEnvironment.STORE_ADMIN,
      );
      return AppEnvironment.STORE_ADMIN;
    }
    if (context?.organization) {
      console.log(
        '🔍 Environment from context organization:',
        AppEnvironment.ORG_ADMIN,
      );
      return AppEnvironment.ORG_ADMIN;
    }

    if (user.roles?.includes('super_admin')) {
      console.log(
        '🔍 Environment from super_admin role:',
        AppEnvironment.VENDIX_ADMIN,
      );
      return AppEnvironment.VENDIX_ADMIN;
    }
    if (user.roles?.includes('org_admin') || user.roles?.includes('owner')) {
      console.log('🔍 Environment from org role:', AppEnvironment.ORG_ADMIN);
      return AppEnvironment.ORG_ADMIN;
    }
    if (
      user.roles?.includes('store_admin') ||
      user.roles?.includes('manager')
    ) {
      console.log(
        '🔍 Environment from store role:',
        AppEnvironment.STORE_ADMIN,
      );
      return AppEnvironment.STORE_ADMIN;
    }

    console.log('🔍 Default environment:', AppEnvironment.VENDIX_LANDING);
    return AppEnvironment.VENDIX_LANDING;
  }
}
