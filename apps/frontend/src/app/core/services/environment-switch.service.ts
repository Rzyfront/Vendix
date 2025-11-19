import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError, take, timeout, filter } from 'rxjs/operators';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { AuthService } from './auth.service';
import { AppConfigService } from './app-config.service';
import { environment } from '../../../environments/environment';

export interface SwitchEnvironmentRequest {
  target_environment: 'STORE_ADMIN' | 'ORG_ADMIN';
  store_slug?: string;
}

export interface SwitchEnvironmentData {
  user: any;
  tokens: {
    access_token: string;
    refresh_token: string;
  };
  permissions: string[];
  roles: string[];
  updated_environment: string;
}

export interface SwitchEnvironmentResponse {
  success: boolean;
  message?: string;
  data?: any;
}

@Injectable({
  providedIn: 'root',
})
export class EnvironmentSwitchService {
  private readonly apiUrl = environment.apiUrl + '/auth';
  private http = inject(HttpClient);
  private authFacade = inject(AuthFacade);
  private authService = inject(AuthService);
  private appConfigService = inject(AppConfigService);
  private router = inject(Router);
  private location = inject(Location);

  switchToStore(storeSlug: string): Observable<SwitchEnvironmentResponse> {
    const request: SwitchEnvironmentRequest = {
      target_environment: 'STORE_ADMIN',
      store_slug: storeSlug,
    };

    // Verificar que tenemos un token antes de hacer la petición
    const current_token = this.authService.getToken();
    if (!current_token) {
      console.error('No authentication token available for environment switch');
      return of(this.createErrorResponse('No authentication token available'));
    }

    // Token logging removed for production

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
          console.error('Error switching to store environment:', error);
          return of(
            this.createErrorResponse(
              error.error?.message || 'Failed to switch environment',
            ),
          );
        }),
      );
  }

  switchToOrganization(): Observable<SwitchEnvironmentResponse> {
    const request: SwitchEnvironmentRequest = {
      target_environment: 'ORG_ADMIN',
    };

    // Verificar que tenemos un token antes de hacer la petición
    const current_token = this.authService.getToken();
    if (!current_token) {
      console.error('No authentication token available for environment switch');
      return of(this.createErrorResponse('No authentication token available'));
    }

    // Token logging removed for production

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
          console.error('Error switching to organization environment:', error);
          return of(
            this.createErrorResponse(
              error.error?.message || 'Failed to switch environment',
            ),
          );
        }),
      );
  }

  /**
   * Realiza el cambio de entorno de forma robusta y segura
   * Elimina las race conditions y garantiza la sincronización completa
   */
  async performEnvironmentSwitch(
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
  ): Promise<boolean> {
    try {
      console.log(
        '🔍 EnvironmentSwitchService - performEnvironmentSwitch called:',
        {
          targetEnvironment,
          storeSlug,
          timestamp: new Date().toISOString(),
        },
      );

      // 1. Validar parámetros
      if (targetEnvironment === 'STORE_ADMIN' && !storeSlug) {
        throw new Error('Store slug is required for STORE_ADMIN environment');
      }

      // 2. Ejecutar la llamada al backend
      let response: SwitchEnvironmentResponse | undefined;

      if (targetEnvironment === 'STORE_ADMIN' && storeSlug) {
        response = (await this.switchToStore(
          storeSlug,
        ).toPromise()) as SwitchEnvironmentResponse;
      } else if (targetEnvironment === 'ORG_ADMIN') {
        response =
          (await this.switchToOrganization().toPromise()) as SwitchEnvironmentResponse;
      } else {
        throw new Error('Invalid environment switch request');
      }

      // Response logging removed

      // 3. Extraer datos de la respuesta del backend
      const response_data = response.data || response;

      // 4. Validar respuesta del backend (nueva estructura idéntica a login)
      if (
        !response?.success ||
        (!response_data?.access_token && !response_data?.tokens)
      ) {
        console.error(
          '❌ Environment switch failed: Invalid response',
          response,
        );
        throw new Error(response?.message || 'Invalid response from server');
      }

      // Normalizar environment (manejar camelCase del backend nuevo)
      const updated_environment =
        response_data.updated_environment || response_data.updatedEnvironment;
      // Asegurar que response_data tenga la propiedad en snake_case para compatibilidad
      response_data.updated_environment = updated_environment;

      // 5. Extraer tokens del formato actualizado (estructura de login unificada)
      // Priorizar la estructura de respuesta unificada del backend
      const raw_tokens = response_data.tokens || {
        access_token: response_data.access_token,
        refresh_token: response_data.refresh_token,
        token_type: response_data.token_type,
        expires_in: response_data.expires_in,
      };

      // Normalizar a camelCase para asegurar compatibilidad con AuthState y persistencia
      // Manejar explícitamente los casos donde access_token puede venir como propiedad directa
      const normalized_tokens = {
        accessToken:
          raw_tokens.accessToken ||
          raw_tokens.access_token ||
          response_data.access_token,
        refreshToken:
          raw_tokens.refreshToken ||
          raw_tokens.refresh_token ||
          response_data.refresh_token,
        tokenType:
          raw_tokens.tokenType ||
          raw_tokens.token_type ||
          response_data.token_type ||
          'Bearer',
        expiresIn:
          raw_tokens.expiresIn ||
          raw_tokens.expires_in ||
          response_data.expires_in ||
          3600,
      };

      // Crear objeto compatible con la interfaz esperada por restoreAuthState y saveUnifiedAuthState
      // Necesitamos tanto camelCase (para state interno) como snake_case (para compatibilidad con saveUnifiedAuthState)
      const tokens_payload = {
        ...normalized_tokens,
        access_token: normalized_tokens.accessToken,
        refresh_token: normalized_tokens.refreshToken,
        token_type: normalized_tokens.tokenType,
        expires_in: normalized_tokens.expiresIn,
      };

      // 6. Actualizar estado de autenticación con estructura completa
      console.log('🔍 FRONTEND - Datos enviados a restoreAuthState:', {
        user_roles: response_data.user?.roles,
        user_keys: Object.keys(response_data.user || {}),
        user_has_roles: !!response_data.user?.roles,
        user_has_user_roles: !!response_data.user?.user_roles,
        tokens_extracted: !!normalized_tokens.accessToken,
      });

      this.authFacade.restoreAuthState(
        response_data.user, // Usuario completo con todas las relaciones
        tokens_payload, // Tokens en formato compatible
        response_data.user?.permissions || [], // Permisos del usuario (si vienen)
        response_data.user?.roles || [], // Roles transformados del backend
        response_data.user_settings, // user_settings separado como en login
      );

      // 7. Sincronizar localStorage de forma unificada
      // Pasamos los tokens ya normalizados
      this.saveUnifiedAuthState(response_data, tokens_payload);

      // 8. Actualizar AppConfigService inmediatamente
      await this.updateAppConfig(updated_environment);

      // 9. Esperar a que el estado se sincronice completamente
      await this.waitForAuthStateSync();

      // 10. Verificación final de consistencia
      const isConsistent = await this.verifyEnvironmentConsistency(
        targetEnvironment,
        storeSlug,
      );
      if (!isConsistent) {
        // Environment consistency warning removed
      }

      // 10. Redirigir a la ruta del nuevo entorno
      // Success redirect logging removed
      await this.redirectToEnvironment();

      return true;
    } catch (error) {
      console.error('❌ Environment switch failed:', error);
      throw error;
    }
  }

  /**
   * Espera a que el estado de autenticación se sincronice completamente
   */
  private async waitForAuthStateSync(): Promise<void> {
    // Auth state sync wait logging removed

    return new Promise((resolve) => {
      this.authFacade.isAuthenticated$
        .pipe(
          filter((isAuth) => isAuth === true),
          take(1),
          timeout(3000), // Timeout máximo de 3 segundos
        )
        .subscribe({
          next: () => {
            // Auth state sync success logging removed
            resolve();
          },
          error: () => {
            // Auth state sync timeout warning removed
            resolve();
          },
        });
    });
  }

  /**
   * Guarda el estado de autenticación de forma unificada en localStorage
   */
  private saveUnifiedAuthState(
    response_data: any,
    normalized_tokens?: any,
  ): void {
    try {
      // Extraer tokens en formato consistente (estructura de login)
      // Si ya vienen normalizados, usarlos. Si no, intentar extraerlos.
      let tokens;

      if (normalized_tokens) {
        tokens = {
          ...normalized_tokens,
          accessToken:
            normalized_tokens.accessToken || normalized_tokens.access_token,
          refreshToken:
            normalized_tokens.refreshToken || normalized_tokens.refresh_token,
        };
      } else {
        // Fallback de compatibilidad
        const raw_tokens = response_data.tokens || {
          access_token: response_data.access_token,
          refresh_token: response_data.refresh_token,
          token_type: response_data.token_type || 'Bearer',
          expires_in: response_data.expires_in || 3600,
        };
        tokens = {
          accessToken: raw_tokens.access_token || raw_tokens.accessToken,
          refreshToken: raw_tokens.refresh_token || raw_tokens.refreshToken,
          tokenType: raw_tokens.token_type || 'Bearer',
          expiresIn: raw_tokens.expires_in || 3600,
        };
      }

      const unified_state = {
        user: response_data.user, // Usuario completo con relaciones
        user_settings: response_data.user_settings, // Configuración actualizada
        tokens: tokens, // Tokens en formato estándar (camelCase)
        environment: response_data.updated_environment,
        timestamp: Date.now(),
      };

      // Guardar estado unificado
      localStorage.setItem('vendix_auth_state', JSON.stringify(unified_state));

      // Guardar environment por separado para compatibilidad
      localStorage.setItem(
        'vendix_user_environment',
        response_data.updated_environment,
      );

      // Guardar tokens individualmente para compatibilidad con AuthService
      if (tokens.accessToken) {
        localStorage.setItem('access_token', tokens.accessToken);
      }
      if (tokens.refreshToken) {
        localStorage.setItem('refresh_token', tokens.refreshToken);
      }

      // Auth state save logging removed
    } catch (error) {
      console.error('❌ Failed to save auth state to localStorage:', error);
    }
  }

  /**
   * Actualiza el AppConfigService con el nuevo entorno
   */
  private async updateAppConfig(newEnvironment: string): Promise<void> {
    try {
      // App config update logging removed

      // Forzar la recarga de la configuración
      const currentConfig = await this.appConfigService.setupConfig();

      // Actualizar explícitamente el entorno
      this.appConfigService.updateEnvironmentForUser(
        currentConfig,
        newEnvironment,
      );

      // App config success logging removed
    } catch (error) {
      console.error('❌ Failed to update AppConfigService:', error);
      // No lanzamos error para no interrumpir el flujo principal
    }
  }

  /**
   * Verifica la consistencia del entorno después del cambio
   */
  private async verifyEnvironmentConsistency(
    targetEnvironment: string,
    storeSlug?: string,
  ): Promise<boolean> {
    try {
      // Verificar que el entorno en localStorage coincida
      const cached_env = localStorage.getItem('vendix_user_environment');
      if (cached_env !== targetEnvironment) {
        // Environment mismatch warning removed
        return false;
      }

      // Verificar que los tokens existan
      const access_token = localStorage.getItem('access_token');
      const refresh_token = localStorage.getItem('refresh_token');
      if (!access_token || !refresh_token) {
        // Missing tokens warning removed
        return false;
      }

      // Si es STORE_ADMIN, verificar que tenemos el store_slug
      if (targetEnvironment === 'STORE_ADMIN' && storeSlug) {
        const auth_state = JSON.parse(
          localStorage.getItem('vendix_auth_state') || '{}',
        );
        if (auth_state.user?.store?.slug !== storeSlug) {
          // Store slug mismatch warning removed
          return false;
        }
      }

      // Environment consistency verification logging removed
      return true;
    } catch (error) {
      console.error('❌ Error verifying environment consistency:', error);
      return false;
    }
  }

  /**
   * Redirige a la ruta correcta y recarga la aplicación para aplicar el nuevo contexto
   */
  private async redirectToEnvironment(): Promise<void> {
    try {
      // Esperar un momento para asegurar que localStorage se ha sincronizado
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Ruta base para todos los entornos
      const redirect_path = '/admin/dashboard';

      // 1. Navegar primero para actualizar la URL si es necesario
      await this.router.navigate([redirect_path]);

      // 2. Recargar la página para reiniciar la aplicación con el nuevo contexto
      // Ahora es seguro hacerlo porque los tokens están en el formato correcto (camelCase)
      window.location.reload();
    } catch (error) {
      console.error('❌ Error redirecting to environment:', error);
      // Fallback seguro que también fuerza la recarga
      window.location.href = '/admin/dashboard';
    }
  }

  /**
   * Crea un objeto de respuesta de error estandarizado
   */
  private createErrorResponse(message: string) {
    return {
      success: false,
      message,
    };
  }
}
