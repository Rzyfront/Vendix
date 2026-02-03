import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, mergeMap, take } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { environment } from '../../../environments/environment';

// Interfaces...
export interface LoginDto {
  email: string;
  password: string;
  store_slug?: string;
  organization_slug?: string;
}
export interface UserRole {
  id: number;
  user_id: number;
  role_id: number;
  roles: {
    id: number;
    name: string;
    description: string;
    is_system_role: boolean;
    created_at: string;
    updated_at: string;
  };
}
export interface User {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  state: string;
  roles?: string[];
  user_roles?: UserRole[];
}
export interface UserSettings {
  id: number;
  user_id: number;
  app_type: string; // NEW: Direct field (required)
  config: { panel_ui: { [key: string]: boolean } }; // app removed from here
}
export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
    user_settings: UserSettings;
    store_settings?: any;
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
    permissions?: string[];
  } | null;
  error?: string;
  meta?: any;
}
export interface RegisterOwnerDto {
  organization_name: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/auth`;

  private http = inject(HttpClient);
  private authFacade = inject(AuthFacade);
  private tenantFacade = inject(TenantFacade);

  login(
    loginDto: LoginDto,
  ): Observable<AuthResponse & { updatedEnvironment?: string }> {
    const enrichedLoginDto = { ...loginDto };
    if (!enrichedLoginDto.organization_slug && !enrichedLoginDto.store_slug) {
      const currentDomain = this.tenantFacade.getCurrentDomainConfig();
      if (currentDomain) {
        enrichedLoginDto.organization_slug = currentDomain.organization_slug;
        enrichedLoginDto.store_slug = currentDomain.store_slug;
      }
    }

    return this.http
      .post<AuthResponse>(`${this.API_URL}/login`, enrichedLoginDto)
      .pipe(
        mergeMap(async (response: AuthResponse) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Login failed');
          }

          const { user, user_settings, store_settings, access_token, refresh_token } =
            response.data;

          const decodedToken = this.decodeJwtToken(access_token);
          // Los roles ahora vienen directamente como array de strings desde la API
          user.roles = user.roles || [];

          // NEW STANDARD: Read app_type directly
          const userAppType = (user_settings as any).app_type || 'ORG_ADMIN';

          if (
            !this.validateUserEnvironmentAccess(
              user.roles || [],
              (userAppType || '').toUpperCase(),
            )
          ) {
            this.clearTokens();
            throw new Error(
              `Acceso denegado: Tu rol no permite acceso al entorno ${userAppType}.`,
            );
          }

          return {
            ...response,
            data: {
              ...response.data,
              user,
              user_settings,
              store_settings,
              permissions: decodedToken?.permissions || [],
            },
            updatedEnvironment: (userAppType || '').toUpperCase(),
          };
        }),
      );
  }

  loginCustomer(
    loginData: any,
  ): Observable<AuthResponse & { updatedEnvironment?: string }> {
    // 🔒 LIMPIEZA DE SEGURIDAD
    this.checkAndCleanAuthResidues();

    console.log('🔐 Iniciando login de customer');

    // Asegurar que no enviamos 'type' si viene de un action de NgRx
    const { type, ...cleanData } = loginData;

    return this.http
      .post<AuthResponse>(`${this.API_URL}/login-customer`, cleanData)
      .pipe(
        mergeMap(async (response: AuthResponse) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Login failed');
          }

          const { user, user_settings, store_settings, access_token, refresh_token } =
            response.data;

          const decodedToken = this.decodeJwtToken(access_token);
          user.roles = user.roles || [];

          return {
            ...response,
            data: {
              ...response.data,
              user,
              user_settings,
              permissions: decodedToken?.permissions || [],
            },
            updatedEnvironment: 'STORE_ECOMMERCE',
          };
        }),
      );
  }

  public validateUserEnvironmentAccess(
    userRoles: string[],
    targetEnv: string,
  ): boolean {
    if (!userRoles || userRoles.length === 0) return false;
    const normalizedEnv = (targetEnv || '').toUpperCase();
    const primaryRole = userRoles[0];
    switch (primaryRole) {
      case 'super_admin':
        return normalizedEnv === 'VENDIX_ADMIN';
      case 'admin':
      case 'owner':
        return normalizedEnv === 'ORG_ADMIN' || normalizedEnv === 'STORE_ADMIN';
      case 'manager':
      case 'employee':
        return normalizedEnv === 'STORE_ADMIN';
      case 'customer':
        return normalizedEnv === 'STORE_ECOMMERCE';
      default:
        return normalizedEnv === 'STORE_ADMIN';
    }
  }

  // === MÉTODOS RESTAURADOS PARA LOS EFFECTS ===
  registerOwner(
    registerData: RegisterOwnerDto,
  ): Observable<AuthResponse & { updatedEnvironment?: string }> {
    // 🔒 LIMPIEZA DE SEGURIDAD: Eliminar cualquier residuo de sesión anterior antes de registrar
    this.authFacade.clearAuthState(); // Limpiar estado de NgRx
    this.clearAllAuthData(); // Limpiar LocalStorage completamente

    // 🔒 DOBLE SEGURIDAD: Establecer bandera para prevenir restauración de environment
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vendix_logged_out_recently', Date.now().toString());
      // Forzar limpieza del environment cacheado específicamente para nuevos registros
      localStorage.removeItem('vendix_user_environment');
      localStorage.removeItem('vendix_app_config');
    }

    console.log(
      '🔐 Iniciando registro de owner con estado limpio y sin environment previo',
    );

    return this.http
      .post<AuthResponse>(`${this.API_URL}/register-owner`, registerData)
      .pipe(
        mergeMap(async (response: AuthResponse) => {
          if (!response.success || !response.data) {
            return response;
          }

          const { user, user_settings, store_settings, access_token, refresh_token } =
            response.data;

          const decodedToken = this.decodeJwtToken(access_token);
          // Los roles ahora vienen directamente como array de strings desde la API
          user.roles = user.roles || [];

          // NEW STANDARD: Read app_type directly
          const userAppType = (user_settings as any).app_type || 'ORG_ADMIN';

          if (
            !this.validateUserEnvironmentAccess(
              user.roles || [],
              (userAppType || '').toUpperCase(),
            )
          ) {
            this.clearTokens();
            throw new Error(
              `Acceso denegado: Tu rol no permite acceso al entorno ${userAppType}.`,
            );
          }

          return {
            ...response,
            data: {
              ...response.data,
              user,
              user_settings,
              store_settings,
              permissions: decodedToken?.permissions || [],
            },
            updatedEnvironment: (userAppType || '').toUpperCase(),
          };
        }),
      );
  }

  /**
   * Limpia datos locales de autenticación y notifica al backend.
   * La navegación y toasts son manejados por SessionService.
   */
  logout(options?: { redirect?: boolean }): void {
    const refreshToken = this.getRefreshToken();

    // 1. Limpieza Local Inmediata
    this.authFacade.clearAuthState();
    this.clearAllAuthData();

    // Bandera de logout
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vendix_logged_out_recently', Date.now().toString());
    }

    console.log('[AuthService] Logout - local state cleared');

    // 2. Notificación Backend (Fire and forget)
    // No esperamos la respuesta para bloquear la UI
    if (refreshToken) {
      this.http.post(`${this.API_URL}/logout`, {
        refresh_token: refreshToken,
      }).pipe(
        take(1)
      ).subscribe({
        error: (err) => console.warn('[AuthService] Backend logout signaling failed', err)
      });
    }

    // NOTA: La navegación es manejada por SessionService
  }

  registerCustomer(
    registerData: any,
  ): Observable<AuthResponse & { updatedEnvironment?: string }> {
    // 🔒 LIMPIEZA DE SEGURIDAD: Eliminar cualquier residuo de sesión anterior antes de registrar
    this.checkAndCleanAuthResidues();

    console.log('🔐 Iniciando registro de customer con estado limpio');

    // Asegurar que no enviamos 'type' si viene de un action de NgRx
    const { type, ...cleanData } = registerData;

    return this.http
      .post<AuthResponse>(`${this.API_URL}/register-customer`, cleanData)
      .pipe(
        mergeMap(async (response: AuthResponse) => {
          if (!response.success || !response.data) {
            return response;
          }

          const { user, user_settings, store_settings, access_token, refresh_token } =
            response.data;

          const decodedToken = this.decodeJwtToken(access_token);
          user.roles = user.roles || [];

          // NEW STANDARD: Read app_type directly
          const userAppType = (user_settings as any).app_type || 'STORE_ECOMMERCE';

          return {
            ...response,
            data: {
              ...response.data,
              user,
              user_settings,
              store_settings,
              permissions: decodedToken?.permissions || [],
            },
            updatedEnvironment: (userAppType || '').toUpperCase(),
          };
        }),
      );
  }
  refreshToken(): Observable<any> {
    const refreshToken = this.getRefreshToken();
    return this.http.post(`${this.API_URL}/refresh`, {
      refresh_token: refreshToken,
    });
  }
  verifyEmail(token: string): Observable<any> {
    return this.http.post(`${this.API_URL}/verify-email`, { token });
  }
  resendVerification(email: string): Observable<any> {
    return this.http.post(`${this.API_URL}/resend-verification`, { email });
  }
  forgotOwnerPassword(
    organization_slug: string,
    email: string,
  ): Observable<any> {
    return this.http.post(`${this.API_URL}/forgot-owner-password`, {
      organization_slug,
      email,
    });
  }
  resetOwnerPassword(token: string, new_password: string): Observable<any> {
    return this.http.post(`${this.API_URL}/reset-owner-password`, {
      token,
      new_password,
    });
  }

  getProfile(): Observable<any> {
    return this.http.get(`${this.API_URL}/profile`);
  }

  updateProfile(data: any): Observable<any> {
    return this.http.put(`${this.API_URL}/profile`, data);
  }

  getSettings(): Observable<any> {
    return this.http.get(`${this.API_URL}/settings`).pipe(
      map((response: any) => {
        const settings = response.data || response;
        const config = settings?.config;

        // Add preferences if missing
        if (config && !config.preferences) {
          return {
            ...settings,
            config: {
              ...config,
              preferences: {
                language: 'es',
                theme: 'aura',
              },
            },
          };
        }

        return response;
      }),
    );
  }

  updateSettings(data: any): Observable<any> {
    return this.http.put(`${this.API_URL}/settings`, data);
  }

  changePassword(
    current_password: string,
    new_password: string,
  ): Observable<any> {
    return this.http.post(`${this.API_URL}/change-password`, {
      current_password,
      new_password,
    });
  }

  // === MÉTODOS DE AYUDA ===
  getToken(): string | null {
    return this.authFacade.getTokens()?.access_token || null;
  }
  getRefreshToken(): string | null {
    return this.authFacade.getTokens()?.refresh_token || null;
  }
  private clearTokens(): void {
    // This method is now a no-op since tokens are stored in vendix_auth_state
    // The actual cleanup is handled by clearAllAuthData() and the NgRx reducer
    if (typeof localStorage !== 'undefined') {
      // Still try to remove legacy keys for cleanup
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  }

  /**
   * Limpia COMPLETAMENTE todos los datos de autenticación del localStorage
   * Usar antes de registro para evitar mezclar datos de sesiones anteriores
   */
  clearAllAuthData(): void {
    if (typeof localStorage !== 'undefined') {
      // Eliminar claves principales de autenticación
      const primaryKeysToRemove = [
        'vendix_auth_state',
        'vendix_user_environment',
      ];

      primaryKeysToRemove.forEach((key) => {
        localStorage.removeItem(key);
      });

      // Also try to remove legacy keys for cleanup (if they exist)
      const legacyKeysToRemove = [
        'access_token',
        'refresh_token',
        'vendix_user_info',
        'user_settings',
        'permissions',
        'roles',
      ];

      legacyKeysToRemove.forEach((key) => {
        localStorage.removeItem(key);
      });

      console.log('🧹 Limpieza completa de datos de autenticación realizada');
    }
  }

  /**
   * Verifica si hay residuos de autenticación y los limpia
   * Retorna true si se limpiaron datos, false si no había residuos
   */
  checkAndCleanAuthResidues(): boolean {
    if (typeof localStorage === 'undefined') return false;

    const hasResidues = [
      'vendix_auth_state',
      // Also check legacy keys for cleanup
      'access_token',
      'refresh_token',
      'vendix_user_info',
    ].some((key) => localStorage.getItem(key) !== null);

    if (hasResidues) {
      console.log('🔍 Detectados residuos de autenticación, limpiando...');
      this.clearAllAuthData();
      return true;
    }

    return false;
  }
  private decodeJwtToken(token: string): any {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch (error) {
      return null;
    }
  }
}
