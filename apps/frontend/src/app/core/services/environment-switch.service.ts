import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError, take, timeout, filter } from 'rxjs/operators';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { AuthService } from './auth.service';
import { AppConfigService } from './app-config.service';
import { RouteManagerService } from './route-manager.service';
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
  private routeManager = inject(RouteManagerService);
  private router = inject(Router);
  private location = inject(Location);

  switchToStore(storeSlug: string): Observable<SwitchEnvironmentResponse> {
    const request: SwitchEnvironmentRequest = {
      target_environment: 'STORE_ADMIN',
      store_slug: storeSlug,
    };

    const current_token = this.authService.getToken();
    if (!current_token) {
      return of(this.createErrorResponse('No authentication token available'));
    }

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
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

    const current_token = this.authService.getToken();
    if (!current_token) {
      return of(this.createErrorResponse('No authentication token available'));
    }

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
          return of(
            this.createErrorResponse(
              error.error?.message || 'Failed to switch environment',
            ),
          );
        }),
      );
  }

  async performEnvironmentSwitch(
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
  ): Promise<boolean> {
    try {
      if (targetEnvironment === 'STORE_ADMIN' && !storeSlug) {
        throw new Error('Store slug is required for STORE_ADMIN environment');
      }

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

      const response_data = response.data || response;

      if (
        !response?.success ||
        (!response_data?.access_token && !response_data?.tokens)
      ) {
        throw new Error(response?.message || 'Invalid response from server');
      }

      const updated_environment =
        response_data.updated_environment || response_data.updatedEnvironment;
      response_data.updated_environment = updated_environment;

      const raw_tokens = response_data.tokens || {
        access_token: response_data.access_token,
        refresh_token: response_data.refresh_token,
        token_type: response_data.token_type,
        expires_in: response_data.expires_in,
      };

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

      const tokens_payload = {
        ...normalized_tokens,
        access_token: normalized_tokens.accessToken,
        refresh_token: normalized_tokens.refreshToken,
        token_type: normalized_tokens.tokenType,
        expires_in: normalized_tokens.expiresIn,
      };

      this.authFacade.restoreAuthState(
        response_data.user,
        tokens_payload,
        response_data.user?.permissions || [],
        response_data.user?.roles || [],
        response_data.user_settings,
      );

      this.saveUnifiedAuthState(response_data, tokens_payload);

      // 8. Actualizar configuración y RUTAS inmediatamente
      await this.updateAppConfigAndRoutes(updated_environment);

      await this.waitForAuthStateSync();

      // 10. Redirigir y RECARGAR para asegurar contexto limpio
      await this.redirectToEnvironment();

      return true;
    } catch (error) {
      console.error('❌ Environment switch failed:', error);
      throw error;
    }
  }

  private async waitForAuthStateSync(): Promise<void> {
    return new Promise((resolve) => {
      this.authFacade.isAuthenticated$
        .pipe(
          filter((isAuth) => isAuth === true),
          take(1),
          timeout(3000),
        )
        .subscribe({
          next: () => resolve(),
          error: () => resolve(),
        });
    });
  }

  private saveUnifiedAuthState(
    response_data: any,
    normalized_tokens?: any,
  ): void {
    try {
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
        user: response_data.user,
        user_settings: response_data.user_settings,
        tokens: tokens,
        environment: response_data.updated_environment,
        timestamp: Date.now(),
      };

      localStorage.setItem('vendix_auth_state', JSON.stringify(unified_state));
      localStorage.setItem(
        'vendix_user_environment',
        response_data.updated_environment,
      );
    } catch (error) {
      console.error('❌ Failed to save auth state to localStorage:', error);
    }
  }

  private async updateAppConfigAndRoutes(
    newEnvironment: string,
  ): Promise<void> {
    try {
      // 1. Forzar la recarga de la configuración desde los servicios
      const currentConfig = await this.appConfigService.setupConfig();

      // 2. Actualizar el entorno en el servicio de configuración
      const updatedConfig = this.appConfigService.updateEnvironmentForUser(
        currentConfig,
        newEnvironment,
      );

      // 3. ¡CRÍTICO! Actualizar las rutas en el Router inmediatamente
      console.log(
        '[EnvironmentSwitch] Reconfiguring routes for:',
        newEnvironment,
      );
      this.routeManager.configureDynamicRoutes(updatedConfig);
    } catch (error) {
      console.error('❌ Failed to update AppConfig and Routes:', error);
    }
  }

  private async redirectToEnvironment(): Promise<void> {
    try {
      // Delay intencional para que la transición sea suave (600ms)
      // Esto da tiempo a que el spinner se vea y el estado de NgRx se asiente
      await new Promise((resolve) => setTimeout(resolve, 600));

      const redirect_path = '/admin/dashboard';

      // Navegar a la nueva ruta
      const navigated = await this.router.navigate([redirect_path], {
        replaceUrl: true, // No crear historial de la transición
      });

      if (!navigated) {
        console.warn('[EnvironmentSwitch] Navigation failed, forcing reload');
        window.location.href = redirect_path;
        return;
      }

      // OPCIONAL: Podrías omitir el reload() si confías plenamente en el estado de NgRx.
      // Pero para Vendix, al cambiar de ORG a STORE, hay muchos IDs de contexto que limpiar.
      // Hacemos el reload DESPUÉS de navegar para que el usuario ya vea el nuevo dashboard.
      setTimeout(() => {
        // window.location.reload(); // Si quieres máxima fluidez, comenta esta línea.
        // Pero es recomendable para limpiar singletons de servicios.
      }, 100);
    } catch (error) {
      console.error('❌ Error redirecting to environment:', error);
      window.location.href = '/admin/dashboard';
    }
  }

  private createErrorResponse(message: string) {
    return {
      success: false,
      message,
    };
  }
}
