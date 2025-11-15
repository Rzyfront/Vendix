import { AuthState } from './auth/auth.reducer';
import { User } from '../services/auth.service';

// --- UNIFIED HYDRATION LOGIC ---

/**
 * Rehydrates the authentication state from localStorage.
 * This is the single source of truth for re-creating the session on page load.
 */
export function hydrateAuthState(): Partial<AuthState> {
  try {
    const unifiedAuthState = localStorage.getItem('vendix_auth_state');
    if (unifiedAuthState) {
      const parsedState = JSON.parse(unifiedAuthState);
      if (parsedState.user && parsedState.tokens?.accessToken) {
        console.log(
          '[HYDRATE] OK unified with user_settings',
          parsedState.user.email,
        );
        return {
          user: parsedState.user,
          user_settings: parsedState.user_settings,
          tokens: parsedState.tokens,
          roles: parsedState.user.roles || parsedState.roles || [],
          permissions: parsedState.permissions || [],
          loading: false,
          error: null,
          isAuthenticated: true,
        };
      }
    }
    const userJson = localStorage.getItem('vendix_user_info');
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const userEnvironment = localStorage.getItem('vendix_user_environment');

    if (userJson && accessToken && refreshToken) {
      const user: User = JSON.parse(userJson);

      // Create user_settings from environment for backward compatibility
      const user_settings = userEnvironment
        ? { config: { app: userEnvironment } }
        : undefined;

      const unifiedState = {
        user,
        user_settings,
        tokens: { accessToken, refreshToken },
        roles: user.roles || [],
        permissions: [],
      };
      localStorage.setItem('vendix_auth_state', JSON.stringify(unifiedState));
      return {
        user: user,
        user_settings,
        tokens: { accessToken, refreshToken },
        roles: user.roles || [],
        permissions: [],
        loading: false,
        error: null,
        isAuthenticated: true,
      };
    }
  } catch (error) {
    console.warn(
      '[HYDRATE] ERROR, no se puede parsear vendix_auth_state, retornando estado inicial ',
      error,
    );
  }
  console.warn('[HYDRATE] DEFAULT, no auth state');
  return {
    user: null,
    user_settings: null,
    tokens: null,
    roles: [],
    permissions: [],
    loading: false,
    error: null,
    isAuthenticated: false,
  };
}

/**
 * Saves authentication state to localStorage for persistence
 */
export function saveAuthState(state: AuthState): void {
  try {
    if (state.user && state.tokens) {
      const stateToSave = {
        user: state.user,
        user_settings: state.user_settings,
        tokens: state.tokens,
        roles: state.roles,
        permissions: state.permissions,
      };
      localStorage.setItem('vendix_auth_state', JSON.stringify(stateToSave));

      // Also save to granular keys for backward compatibility
      localStorage.setItem('vendix_user_info', JSON.stringify(state.user));
      localStorage.setItem('access_token', state.tokens.accessToken);
      localStorage.setItem('refresh_token', state.tokens.refreshToken);

      // Keep vendix_user_environment in sync with user_settings.config.app for compatibility
      if (state.user_settings?.config?.app) {
        localStorage.setItem(
          'vendix_user_environment',
          state.user_settings.config.app,
        );
      }
    }
  } catch (error) {
    console.warn('[PERSISTENCE] Failed to save auth state:', error);
  }
}

/**
 * Clears authentication state from localStorage
 */
export function clearAuthState(): void {
  try {
    console.warn('[CLEAR AUTH STATE]');
    localStorage.removeItem('vendix_auth_state');
    localStorage.removeItem('vendix_user_info');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  } catch (error) {
    // Silenciar otros logs
  }
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
