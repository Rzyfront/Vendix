import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActionReducer, MetaReducer } from '@ngrx/store';
import { TenantState } from './tenant/tenant.reducer';
import { AuthState } from './auth/auth.reducer';

// Storage keys
const TENANT_STORAGE_KEY = 'vendix_tenant_state';
const AUTH_STORAGE_KEY = 'vendix_auth_state';

// Persistence configuration
export interface PersistenceConfig {
  tenant: {
    enabled: boolean;
    keys: (keyof TenantState)[];
  };
  auth: {
    enabled: boolean;
    keys: (keyof AuthState)[];
  };
}

const DEFAULT_CONFIG: PersistenceConfig = {
  tenant: {
    enabled: true,
    keys: ['domainConfig', 'tenantConfig', 'environment']
  },
  auth: {
    enabled: true,
    keys: ['user'] // Don't persist tokens for security
  }
};

@Injectable({
  providedIn: 'root'
})
export class StorePersistenceService {
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  // Save state to localStorage
  saveState(key: string, state: any): void {
    if (!this.isBrowser) return;

    try {
      const serializedState = JSON.stringify(state);
      localStorage.setItem(key, serializedState);
    } catch (error) {
      console.warn(`Failed to save state to localStorage:`, error);
    }
  }

  // Load state from localStorage
  loadState(key: string): any {
    if (!this.isBrowser) return null;

    try {
      const serializedState = localStorage.getItem(key);
      if (serializedState) {
        return JSON.parse(serializedState);
      }
    } catch (error) {
      console.warn(`Failed to load state from localStorage:`, error);
    }
    return null;
  }

  // Clear persisted state
  clearState(key: string): void {
    if (!this.isBrowser) return;

    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Failed to clear state from localStorage:`, error);
    }
  }

  // Clear all persisted state
  clearAllState(): void {
    this.clearState(TENANT_STORAGE_KEY);
    this.clearState(AUTH_STORAGE_KEY);
  }
}

// Meta reducer for tenant state persistence
export function tenantPersistenceMetaReducer(
  persistenceService: StorePersistenceService,
  config: PersistenceConfig = DEFAULT_CONFIG
): MetaReducer<TenantState> {
  return (reducer: ActionReducer<TenantState>) => {
    return (state, action) => {
      const newState = reducer(state, action);

      // Only persist if enabled and in browser
      if (config.tenant.enabled && persistenceService['isBrowser']) {
        const stateToPersist: Partial<TenantState> = {};

        config.tenant.keys.forEach(key => {
          if (newState && key in newState) {
            (stateToPersist as any)[key] = newState[key];
          }
        });

        persistenceService.saveState(TENANT_STORAGE_KEY, stateToPersist);
      }

      return newState;
    };
  };
}

// Meta reducer for auth state persistence
export function authPersistenceMetaReducer(
  persistenceService: StorePersistenceService,
  config: PersistenceConfig = DEFAULT_CONFIG
): MetaReducer<AuthState> {
  return (reducer: ActionReducer<AuthState>) => {
    return (state, action) => {
      const newState = reducer(state, action);

      // Only persist if enabled and in browser
      if (config.auth.enabled && persistenceService['isBrowser']) {
        const stateToPersist: Partial<AuthState> = {};

        config.auth.keys.forEach(key => {
          if (newState && key in newState) {
            (stateToPersist as any)[key] = newState[key];
          }
        });

        persistenceService.saveState(AUTH_STORAGE_KEY, stateToPersist);
      }

      return newState;
    };
  };
}

// Hydration functions for initial state
export function getPersistedTenantState(persistenceService: StorePersistenceService): Partial<TenantState> | undefined {
  return persistenceService.loadState(TENANT_STORAGE_KEY);
}

export function getPersistedAuthState(persistenceService: StorePersistenceService): Partial<AuthState> | undefined {
  return persistenceService.loadState(AUTH_STORAGE_KEY);
}