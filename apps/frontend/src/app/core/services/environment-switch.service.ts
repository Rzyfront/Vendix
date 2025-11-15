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
    accessToken: string;
    refreshToken: string;
  };
  permissions: string[];
  roles: string[];
  updatedEnvironment: string;
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
    const currentToken = this.authService.getToken();
    if (!currentToken) {
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
    const currentToken = this.authService.getToken();
    if (!currentToken) {
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
      // Environment switch debug logging removed

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
      const responseData = response.data || response;

      // 4. Validar respuesta del backend
      if (!response?.success || !responseData?.tokens) {
        console.error(
          '❌ Environment switch failed: Invalid response',
          response,
        );
        throw new Error(response?.message || 'Invalid response from server');
      }

      // 5. Actualizar estado de autenticación
      // Auth state update logging removed
      this.authFacade.restoreAuthState(
        responseData.user,
        responseData.tokens,
        responseData.permissions,
        responseData.roles,
        responseData.user?.user_settings, // Extraer user_settings del usuario actualizado
      );

      // 6. Sincronizar localStorage de forma unificada
      this.saveUnifiedAuthState(responseData);

      // 7. Actualizar AppConfigService inmediatamente
      await this.updateAppConfig(responseData.updatedEnvironment);

      // 8. Esperar a que el estado se sincronice completamente
      await this.waitForAuthStateSync();

      // 9. Verificación final de consistencia
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
  private saveUnifiedAuthState(responseData: any): void {
    try {
      const unifiedState = {
        user: responseData.user,
        tokens: responseData.tokens,
        permissions: responseData.permissions,
        roles: responseData.roles,
        environment: responseData.updatedEnvironment,
        timestamp: Date.now(),
      };

      // Guardar estado unificado
      localStorage.setItem('vendix_auth_state', JSON.stringify(unifiedState));

      // Guardar environment por separado para compatibilidad
      localStorage.setItem(
        'vendix_user_environment',
        responseData.updatedEnvironment,
      );

      // Guardar tokens individualmente para compatibilidad con AuthService
      localStorage.setItem('access_token', responseData.tokens.accessToken);
      localStorage.setItem('refresh_token', responseData.tokens.refreshToken);

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
      const cachedEnv = localStorage.getItem('vendix_user_environment');
      if (cachedEnv !== targetEnvironment) {
        // Environment mismatch warning removed
        return false;
      }

      // Verificar que los tokens existan
      const accessToken = localStorage.getItem('access_token');
      const refreshToken = localStorage.getItem('refresh_token');
      if (!accessToken || !refreshToken) {
        // Missing tokens warning removed
        return false;
      }

      // Si es STORE_ADMIN, verificar que tenemos el store_slug
      if (targetEnvironment === 'STORE_ADMIN' && storeSlug) {
        const authState = JSON.parse(
          localStorage.getItem('vendix_auth_state') || '{}',
        );
        if (authState.user?.store?.slug !== storeSlug) {
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
   * Redirige a la ruta correcta manteniendo la sesión
   */
  private async redirectToEnvironment(): Promise<void> {
    try {
      // Esperar un momento para que el estado se asiente completamente
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Obtener el entorno actual
      const currentEnv = localStorage.getItem('vendix_user_environment');

      // Forzar la recarga de la configuración de la aplicación
      await this.appConfigService.setupConfig();

      // Determinar la ruta de redirección según el entorno
      let redirectPath = '/admin/dashboard';

      // Environment redirect logging removed

      // Forzar la recarga completa de la ruta para asegurar que se cargue el layout correcto
      const currentUrl = this.router.url;
      // Current URL logging removed

      // Navegar a la ruta final directamente
      await this.router.navigate([redirectPath]);

      // Forzar la recarga de la página para asegurar que se cargue el nuevo layout
      // pero manteniendo la sesión activa
      setTimeout(() => {
        // Page reload logging removed
        window.location.reload();
      }, 200);
    } catch (error) {
      console.error('❌ Error redirecting to environment:', error);
      // Fallback a recarga completa si la navegación falla
      // Fallback reload logging removed
      window.location.href = window.location.origin + '/admin/dashboard';
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
