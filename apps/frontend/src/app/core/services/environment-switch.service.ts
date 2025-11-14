import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthFacade } from '../../core/store/auth/auth.facade';

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
  private readonly apiUrl = '/api/auth';
  private http = inject(HttpClient);
  private authFacade = inject(AuthFacade);

  switchToStore(storeSlug: string): Observable<SwitchEnvironmentResponse> {
    const request: SwitchEnvironmentRequest = {
      target_environment: 'STORE_ADMIN',
      store_slug: storeSlug,
    };

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
      let response: SwitchEnvironmentResponse;

      if (targetEnvironment === 'STORE_ADMIN' && storeSlug) {
        response = await this.switchToStore(storeSlug).toPromise();
      } else if (targetEnvironment === 'ORG_ADMIN') {
        response = await this.switchToOrganization().toPromise();
      } else {
        throw new Error('Invalid environment switch request');
      }

      if (response?.success && response.tokens) {
        // Actualizar el estado de autenticación con los nuevos tokens
        this.authFacade.restoreAuthState(
          response.user,
          response.tokens,
          response.permissions,
          response.roles,
        );

        // Recargar la página para aplicar el nuevo entorno
        setTimeout(() => {
          window.location.href = window.location.origin;
        }, 100);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Environment switch failed:', error);
      return false;
    }
  }
}
