import { inject } from '@angular/core';
import { MetaReducer } from '@ngrx/store';
import { StorePersistenceService, tenantPersistenceMetaReducer, authPersistenceMetaReducer, getPersistedTenantState, getPersistedAuthState } from './persistence';
import { tenantReducer, initialTenantState, TenantState } from './tenant/tenant.reducer';
import { authReducer, initialAuthState, AuthState } from './auth/auth.reducer';

// Factory functions for meta reducers
export function createTenantMetaReducers(): MetaReducer<TenantState> {
  const persistenceService = inject(StorePersistenceService);
  return tenantPersistenceMetaReducer(persistenceService);
}

export function createAuthMetaReducers(): MetaReducer<AuthState> {
  const persistenceService = inject(StorePersistenceService);
  return authPersistenceMetaReducer(persistenceService);
}

// Hydrate initial state from localStorage
export function hydrateTenantState(): TenantState {
  try {
    const serializedState = localStorage.getItem('vendix_tenant_state');
    if (serializedState) {
      const persistedState = JSON.parse(serializedState);
      return { ...initialTenantState, ...persistedState };
    }
  } catch (error) {
    console.warn(`Failed to load tenant state from localStorage:`, error);
  }
  return initialTenantState;
}

export function hydrateAuthState(): AuthState {
  try {
    const serializedState = localStorage.getItem('vendix_auth_state');
    if (serializedState) {
      const persistedState = JSON.parse(serializedState);
      return { ...initialAuthState, ...persistedState };
    }
  } catch (error) {
    console.warn(`Failed to load auth state from localStorage:`, error);
  }
  return initialAuthState;
}

// Provider for StorePersistenceService
export const STORE_PERSISTENCE_PROVIDER = {
  provide: StorePersistenceService,
  useClass: StorePersistenceService
};

// Re-export for easier importing
export { StorePersistenceService } from './persistence';