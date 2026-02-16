import { AuthState } from './auth/auth.reducer';
import { User } from '../services/auth.service';

// --- UNIFIED HYDRATION LOGIC ---

/**
 * Checks if a JWT token is expired by decoding its payload.
 * Uses a 30-second buffer to account for clock skew.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    const bufferMs = 30 * 1000;
    return Date.now() >= payload.exp * 1000 - bufferMs;
  } catch {
    return true;
  }
}

/**
 * Rehydrates the authentication state from localStorage.
 * This is the single source of truth for re-creating the session on page load.
 */
export function hydrateAuthState(): Partial<AuthState> {
  try {
    // Verificar si el usuario hizo logout recientemente
    const loggedOutRecently = localStorage.getItem(
      'vendix_logged_out_recently',
    );
    if (loggedOutRecently) {
      const logoutTime = parseInt(loggedOutRecently);
      const currentTime = Date.now();
      if (currentTime - logoutTime < 5 * 60 * 1000) {
        console.log(
          '[HYDRATE] Logout reciente detectado, omitiendo hidratación',
        );
        return {
          user: null,
          user_settings: null,
          tokens: null,
          roles: [],
          permissions: [],
          loading: false,
          error: null,
          is_authenticated: false,
        };
      }
    }

    // Solo usar el estado unificado - eliminar lógica de fallback peligrosa
    const unifiedAuthState = localStorage.getItem('vendix_auth_state');
    if (unifiedAuthState) {
      const parsedState = JSON.parse(unifiedAuthState);

      // Validaciones estrictas para prevenir restauración de datos corruptos
      if (!parsedState || !parsedState.user || !parsedState.tokens) {
        console.warn('[HYDRATE] Estado de autenticación inválido o incompleto');
        localStorage.removeItem('vendix_auth_state');
        return getCleanAuthState();
      }

      if (!parsedState.tokens.access_token) {
        console.warn('[HYDRATE] Token de acceso no encontrado');
        localStorage.removeItem('vendix_auth_state');
        return getCleanAuthState();
      }

      if (isTokenExpired(parsedState.tokens.access_token)) {
        console.warn('[HYDRATE] Token de acceso expirado, limpiando sesión');
        localStorage.removeItem('vendix_auth_state');
        return getCleanAuthState();
      }

      console.log(
        '[HYDRATE] Restaurando estado unificado para:',
        parsedState.user.email,
      );
      return {
        user: parsedState.user,
        user_settings: parsedState.user_settings,
        store_settings: parsedState.store_settings, // CRITICAL: Restore store_settings
        tokens: parsedState.tokens,
        roles: parsedState.user.roles || parsedState.roles || [],
        permissions: parsedState.permissions || [],
        loading: false,
        error: null,
        is_authenticated: true,
      };
    }
  } catch (error) {
    console.warn(
      '[HYDRATE] Error parsing auth state, limpiando datos corruptos:',
      error,
    );
    // Limpiar cualquier dato corrupto
    localStorage.removeItem('vendix_auth_state');
    localStorage.removeItem('vendix_logged_out_recently');
  }

  return getCleanAuthState();
}

/**
 * Returns a clean, non-authenticated state
 */
function getCleanAuthState(): Partial<AuthState> {
  return {
    user: null,
    user_settings: null,
    tokens: null,
    roles: [],
    permissions: [],
    loading: false,
    error: null,
    is_authenticated: false,
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
        store_settings: state.store_settings,
        tokens: state.tokens,
        roles: state.roles,
        permissions: state.permissions,
      };
      localStorage.setItem('vendix_auth_state', JSON.stringify(stateToSave));

      // Keep vendix_user_environment in sync with user_settings.app_type
      if (state.user_settings?.app_type) {
        localStorage.setItem(
          'vendix_user_environment',
          state.user_settings.app_type,
        );
      }
    } else {
      // If state is invalid or empty (e.g. after logout), clear storage
      clearAuthState();
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

    // Eliminar todas las claves relacionadas con autenticación
    const keysToRemove = [
      'vendix_auth_state',
      'vendix_user_environment',
    ];

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });

    // Also try to remove legacy keys for cleanup (if they exist)
    const legacyKeysToRemove = [
      'vendix_user_info',
      'access_token',
      'refresh_token',
      'user_settings',
      'permissions',
      'roles',
    ];

    legacyKeysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });

    console.log(
      '[CLEAR AUTH STATE] Todas las claves de autenticación eliminadas',
    );
  } catch (error) {
    console.warn('[CLEAR AUTH STATE] Error limpiando estado:', error);
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
