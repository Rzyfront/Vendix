import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, mergeMap } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthFacade } from '../store/auth/auth.facade';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { ConfigFacade } from '../store/config';
import { AppConfigService } from './app-config.service';
import { NavigationService } from './navigation.service';
import { environment } from '../../../environments/environment';
import { AppEnvironment } from '../models/domain-config.interface';

// Interfaces...
export interface LoginDto { email: string; password: string; store_slug?: string; organization_slug?: string; }
export interface User { id: number; first_name: string; last_name: string; username: string; email: string; state: string; roles?: string[]; }
export interface UserSettings { id: number; user_id: number; config: { app: AppEnvironment; panel_ui: { [key: string]: boolean }; }; }
export interface AuthResponse { success: boolean; message: string; data: { user: User; user_settings: UserSettings; access_token: string; refresh_token: string; token_type: 'Bearer'; expires_in: number; permissions?: string[]; } | null; error?: string; meta?: any; }
export interface RegisterOwnerDto { organization_name: string; email: string; password: string; first_name: string; last_name: string; phone?: string; }

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/auth`;

  private appConfigService = inject(AppConfigService);
  private navigationService = inject(NavigationService);
  private configFacade = inject(ConfigFacade);
  private http = inject(HttpClient);
  private router = inject(Router);
  private authFacade = inject(AuthFacade);
  private tenantFacade = inject(TenantFacade);

  login(loginDto: LoginDto): Observable<AuthResponse & { updatedEnvironment?: string }> {
    const enrichedLoginDto = { ...loginDto };
    if (!enrichedLoginDto.organization_slug && !enrichedLoginDto.store_slug) {
      const currentDomain = this.tenantFacade.getCurrentDomainConfig();
      if (currentDomain) {
        enrichedLoginDto.organization_slug = currentDomain.organization_slug;
        enrichedLoginDto.store_slug = currentDomain.store_slug;
      }
    }

    return this.http.post<AuthResponse>(`${this.API_URL}/login`, enrichedLoginDto)
      .pipe(
        mergeMap(async (response: AuthResponse) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Login failed');
          }

          const { user, user_settings, access_token, refresh_token } = response.data;

          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('access_token', access_token);
            localStorage.setItem('refresh_token', refresh_token);
          }

          const decodedToken = this.decodeJwtToken(access_token);
          user.roles = decodedToken?.roles || [];

          if (!this.validateUserEnvironmentAccess(user.roles || [], (user_settings.config.app || '').toUpperCase())) {
            this.clearTokens();
            throw new Error(`Acceso denegado: Tu rol no permite acceso al entorno ${user_settings.config.app}.`);
          }

          return {
            ...response,
            data: { ...response.data, user, permissions: decodedToken?.permissions || [] },
            updatedEnvironment: (user_settings.config.app || '').toUpperCase()
          };
        })
      );
  }

  public validateUserEnvironmentAccess(userRoles: string[], targetEnv: string): boolean {
    if (!userRoles || userRoles.length === 0) return false;
    const normalizedEnv = (targetEnv || '').toUpperCase();
    const primaryRole = userRoles[0];
    switch (primaryRole) {
      case 'super_admin': return normalizedEnv === 'VENDIX_ADMIN';
      case 'admin':
      case 'owner': return normalizedEnv === 'ORG_ADMIN' || normalizedEnv === 'STORE_ADMIN';
      case 'manager':
      case 'employee': return normalizedEnv === 'STORE_ADMIN';
      case 'customer': return normalizedEnv === 'STORE_ECOMMERCE';
      default: return normalizedEnv === 'STORE_ADMIN';
    }
  }

  // === MÉTODOS RESTAURADOS PARA LOS EFFECTS ===
  registerOwner(registerData: RegisterOwnerDto): Observable<AuthResponse> { return this.http.post<AuthResponse>(`${this.API_URL}/register-owner`, registerData); }
  logout(): Observable<any> { const refreshToken = this.getRefreshToken(); return this.http.post(`${this.API_URL}/logout`, { refresh_token: refreshToken }); }
  refreshToken(): Observable<any> { const refreshToken = this.getRefreshToken(); return this.http.post(`${this.API_URL}/refresh`, { refresh_token: refreshToken }); }
  verifyEmail(token: string): Observable<any> { return this.http.post(`${this.API_URL}/verify-email`, { token }); }
  resendVerification(email: string): Observable<any> { return this.http.post(`${this.API_URL}/resend-verification`, { email }); }
  forgotOwnerPassword(organization_slug: string, email: string): Observable<any> { return this.http.post(`${this.API_URL}/forgot-owner-password`, { organization_slug, email }); }
  resetOwnerPassword(token: string, new_password: string): Observable<any> { return this.http.post(`${this.API_URL}/reset-owner-password`, { token, new_password }); }

  // === MÉTODOS DE AYUDA ===
  getToken(): string | null { return this.authFacade.getTokens()?.accessToken || null; }
  getRefreshToken(): string | null { return this.authFacade.getTokens()?.refreshToken || null; }
  private clearTokens(): void { if(typeof localStorage !== 'undefined') { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); } }
  private decodeJwtToken(token: string): any { try { return JSON.parse(atob(token.split('.')[1])); } catch (error) { return null; } }
}
