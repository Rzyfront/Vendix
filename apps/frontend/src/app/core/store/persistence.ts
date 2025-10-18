import { AuthState } from './auth/auth.reducer';
import { User } from '../services/auth.service';

// --- NEW, SIMPLIFIED HYDRATION LOGIC ---

/**
 * Rehydrates the authentication state from granular localStorage keys.
 * This is the single source of truth for re-creating the session on page load.
 */
export function hydrateAuthState(): Partial<AuthState> {
  try {
    const userJson = localStorage.getItem('vendix_user_info');
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');

    if (userJson && accessToken && refreshToken) {
      const user: User = JSON.parse(userJson);
      console.log('[HYDRATE] Auth state rehydrated for user:', user.email);
      return {
        user: user,
        tokens: { accessToken, refreshToken },
        roles: user.roles || [],
        // Permissions can be re-fetched or decoded from token if needed upon app load
        permissions: [],
        loading: false,
        error: null,
      };
    }
  } catch (error) {
    console.warn('[HYDRATE] Failed to rehydrate auth state from localStorage:', error);
    // Clear potentially corrupted keys
    localStorage.removeItem('vendix_user_info');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  // Return default initial state if hydration fails
  return {
    user: null,
    tokens: null,
    roles: [],
    permissions: [],
    loading: false,
    error: null,
  };
}

/**
 * NOTE: Tenant state hydration is no longer needed.
 * AppConfigService is now the single source of truth for domain and tenant configuration,
 * simplifying the state management flow.
 */
export function hydrateTenantState() {
  // Returns an empty object, as the state will be populated by AppConfigService via actions.
  return {};
}