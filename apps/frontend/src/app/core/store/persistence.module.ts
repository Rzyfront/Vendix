import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return initialTenantState;
  }

  const persistenceService = inject(StorePersistenceService);
  const persistedState = getPersistedTenantState(persistenceService);
  return persistedState ? { ...initialTenantState, ...persistedState } : initialTenantState;
}

export function hydrateAuthState(): AuthState {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return initialAuthState;
  }

  const persistenceService = inject(StorePersistenceService);
  const persistedState = getPersistedAuthState(persistenceService);
  return persistedState ? { ...initialAuthState, ...persistedState } : initialAuthState;
}

// Provider for StorePersistenceService
export const STORE_PERSISTENCE_PROVIDER = {
  provide: StorePersistenceService,
  useClass: StorePersistenceService
};

// Re-export for easier importing
export { StorePersistenceService } from './persistence';