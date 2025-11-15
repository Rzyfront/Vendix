import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface SwitchEnvironmentRequest {
  target_environment: 'STORE_ADMIN' | 'ORG_ADMIN';
  store_slug?: string;
}

export interface SwitchEnvironmentResponse {
  success: boolean;
  user: any;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  permissions: string[];
  roles: string[];
  updatedEnvironment: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class EnvironmentSwitchService {
  private readonly apiUrl = environment.apiUrl + '/auth';
  private http = inject(HttpClient);
  private authFacade = inject(AuthFacade);
  private authService = inject(AuthService);

  switchToStore(storeSlug: string): Observable<SwitchEnvironmentResponse> {
    const request: SwitchEnvironmentRequest = {
      target_environment: 'STORE_ADMIN',
      store_slug: storeSlug,
    };

    // Verificar que tenemos un token antes de hacer la petición
    const currentToken = this.authService.getToken();
    if (!currentToken) {
      console.error('No authentication token available for environment switch');
      return of({
        success: false,
        user: null,
        tokens: { accessToken: '', refreshToken: '' },
        permissions: [],
        roles: [],
        updatedEnvironment: '',
        message: 'No authentication token available',
      });
    }

    console.log(
      'Switching to store with token:',
      currentToken.substring(0, 20) + '...',
    );

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
          console.error('Error switching to store environment:', error);
          return of({
            success: false,
            user: null,
            tokens: { accessToken: '', refreshToken: '' },
            permissions: [],
            roles: [],
            updatedEnvironment: '',
            message: error.error?.message || 'Failed to switch environment',
          });
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
      return of({
        success: false,
        user: null,
        tokens: { accessToken: '', refreshToken: '' },
        permissions: [],
        roles: [],
        updatedEnvironment: '',
        message: 'No authentication token available',
      });
    }

    console.log(
      'Switching to organization with token:',
      currentToken.substring(0, 20) + '...',
    );

    return this.http
      .post<SwitchEnvironmentResponse>(
        `${this.apiUrl}/switch-environment`,
        request,
      )
      .pipe(
        catchError((error) => {
          console.error('Error switching to organization environment:', error);
          return of({
            success: false,
            user: null,
            tokens: { accessToken: '', refreshToken: '' },
            permissions: [],
            roles: [],
            updatedEnvironment: '',
            message: error.error?.message || 'Failed to switch environment',
          });
        }),
      );
  }

  /**
   * Realiza el cambio de entorno y actualiza el estado de autenticación
   */
  async performEnvironmentSwitch(
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
  ): Promise<boolean> {
    try {
      let response: SwitchEnvironmentResponse | undefined;

      if (targetEnvironment === 'STORE_ADMIN' && storeSlug) {
        response = await this.switchToStore(storeSlug).toPromise();
      } else if (targetEnvironment === 'ORG_ADMIN') {
        response = await this.switchToOrganization().toPromise();
      } else {
        throw new Error(
          'Invalid environment switch request: Missing required parameters',
        );
      }

      console.log('Environment switch response:', response);

      if (response?.success && response.tokens) {
        console.log('Updating auth state with new tokens and user:', {
          user: response.user,
          tokens: response.tokens,
          permissions: response.permissions,
          roles: response.roles,
        });

        // Actualizar el estado de autenticación con los nuevos tokens
        this.authFacade.restoreAuthState(
          response.user,
          response.tokens,
          response.permissions,
          response.roles,
        );

        // Esperar un momento para que el estado se actualice y luego recargar
        setTimeout(() => {
          console.log('Reloading page to apply new environment...');
          window.location.href = window.location.origin;
        }, 500);

        return true;
      }

      console.error('Environment switch failed: Invalid response', response);
      return false;
    } catch (error) {
      console.error('Environment switch failed:', error);
      throw error; // Re-throw para mejor manejo de errores en el componente
    }
  }
}
