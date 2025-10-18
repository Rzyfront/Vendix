import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, mergeMap } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthFacade } from '../store/auth/auth.facade';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { AppConfigService } from './app-config.service';
import { NavigationService } from './navigation.service';
import { RouteManagerService } from './route-manager.service';
import { environment } from '../../../environments/environment';
import { AppEnvironment } from '../models/domain-config.interface';

// --- NEW, GRANULAR INTERFACES ---

export interface LoginDto {
  email: string;
  password: string;
  store_slug?: string;
  organization_slug?: string;
}

export interface User {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  state: string;
  roles?: string[]; // Added from token decoding
}

export interface UserSettings {
  id: number;
  user_id: number;
  config: {
    app: AppEnvironment; // Use the existing AppEnvironment enum
    panel_ui: { [key: string]: boolean };
  };
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
    user_settings: UserSettings;
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
    permissions?: string[]; // Permissions from token
  } | null;
  error?: string;
  meta?: any;
}

// --- OTHER DTOs ---

export interface RegisterOwnerDto {
  organization_name: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface RegisterStaffDto {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'manager' | 'supervisor' | 'employee';
  store_id?: number;
}

export interface RegisterCustomerDto {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  storeId: number;
}


@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/auth`;

  private appConfigService = inject(AppConfigService);
  private navigationService = inject(NavigationService);

  constructor(
    private http: HttpClient,
    private router: Router,
    private store: Store,
    private authFacade: AuthFacade,
    private tenantFacade: TenantFacade,
    private routeManager: RouteManagerService
  ) {}

  // Login - Refactored for layered config and granular caching
  login(loginDto: LoginDto): Observable<AuthResponse & { updatedEnvironment?: AppEnvironment }> {
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

          // --- Layer 3: Update App Environment from User Settings ---
          // Ahora esperamos a que se complete la actualización del entorno
          // Pasamos el string directamente, AppConfigService lo normalizará
          await this.appConfigService.updateEnvironmentForUser(user_settings.config.app);

          // --- Granular Caching ---
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('access_token', access_token);
            localStorage.setItem('refresh_token', refresh_token);
            localStorage.setItem('vendix_user_info', JSON.stringify(user));
          }

          // --- Data for NgRx Store ---
          // Decode token to get roles and permissions for the session
          const decodedToken = this.decodeJwtToken(access_token);
          const permissions = decodedToken?.permissions || [];
          const roles = decodedToken?.roles || [];
          user.roles = roles; // Attach roles to the user object for the session

          // --- NEW: Validate that the user's role is allowed for the target environment ---
          if (!this.validateUserEnvironmentAccess(roles, user_settings.config.app)) {
            // Clear any cached data from the failed login
            this.appConfigService.clearCache();
            throw new Error(`Acceso denegado: Tu rol no permite acceso al entorno ${user_settings.config.app}.`);
          }

          // Return the transformed data for the NgRx effect including updated environment
          return {
            ...response,
            data: {
              ...response.data,
              user,
              permissions,
            },
            updatedEnvironment: user_settings.config.app
          };
        })
      );
  }

  /**
   * NEW: Validates if the user's roles grant access to the target AppEnvironment.
   * @param userRoles The roles of the user.
   * @param targetEnv The AppEnvironment from the user's settings.
   * @returns `true` if access is allowed, `false` otherwise.
   */
  public validateUserEnvironmentAccess(userRoles: string[], targetEnv: string): boolean {
    if (!userRoles || userRoles.length === 0) {
      return false; // No roles, no access
    }

    // Get the primary role for simplicity
    const primaryRole = userRoles[0];

    switch (primaryRole) {
      case 'super_admin':
        return targetEnv === 'VENDIX_ADMIN';
      
      case 'admin':
      case 'owner':
        return targetEnv === 'ORG_ADMIN' || targetEnv === 'STORE_ADMIN';

      case 'manager':
        return targetEnv === 'STORE_ADMIN';

      case 'employee':
        return targetEnv === 'STORE_ADMIN';

      case 'customer':
        return targetEnv === 'STORE_ECOMMERCE';

      default:
        // For any other custom role, default to STORE_ADMIN access
        return targetEnv === 'STORE_ADMIN';
    }
  }

  // Register Owner
  registerOwner(registerData: RegisterOwnerDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/register-owner`, registerData);
  }

  // Register Staff
  registerStaff(registerData: RegisterStaffDto): Observable<any> {
    return this.http.post(`${this.API_URL}/register-staff`, registerData);
  }

  // Register Customer
  registerCustomer(registerData: RegisterCustomerDto): Observable<any> {
    return this.http.post(`${this.API_URL}/register-customer`, registerData);
  }

  // Logout - now handled by NgRx effects
  logout(allSessions = false): Observable<any> {
    const refreshToken = this.getRefreshToken();
    return this.http.post(`${this.API_URL}/logout`, {
      all_sessions: allSessions,
      refresh_token: refreshToken
    });
  }

  // Refresh Token
  refreshToken(): Observable<any> {
    const refreshToken = this.getRefreshToken();
    return this.http.post(`${this.API_URL}/refresh`, { refresh_token: refreshToken });
  }

  // Verify Email
  verifyEmail(token: string): Observable<any> {
    return this.http.post(`${this.API_URL}/verify-email`, { token });
  }

  // Resend Verification
  resendVerification(email: string): Observable<any> {
    return this.http.post(`${this.API_URL}/resend-verification`, { email });
  }

  // Forgot Password
  forgotPassword(email: string, organization_slug: string): Observable<any> {
    return this.http.post(`${this.API_URL}/forgot-password`, { email, organization_slug });
  }

  // Reset Password
  resetPassword(token: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.API_URL}/reset-password`, { token, newPassword });
  }

  // Forgot Owner Password
  forgotOwnerPassword(organization_slug: string, email: string): Observable<any> {
    return this.http.post(`${this.API_URL}/forgot-owner-password`, { organization_slug, email });
  }

  // Reset Owner Password
  resetOwnerPassword(token: string, new_password: string): Observable<any> {
    return this.http.post(`${this.API_URL}/reset-owner-password`, { token, new_password });
  }

  // Get current user from store
  getCurrentUser(): any {
    return this.authFacade.getCurrentUser();
  }

  // Check if user is logged in
  isLoggedIn(): boolean {
    return this.authFacade.isLoggedIn();
  }

  // Check if user is admin
  isAdmin(): boolean {
    return this.authFacade.isAdmin();
  }

  // Get access token
  getToken(): string | null {
    const tokens = this.authFacade.getTokens();
    return tokens?.accessToken || null;
  }

  // Get refresh token
  getRefreshToken(): string | null {
    const tokens = this.authFacade.getTokens();
    return tokens?.refreshToken || null;
  }

  // Redirect after login based on user role and context
  redirectAfterLogin(): void {
    console.log('[AUTH SERVICE] Redirección post-login iniciada');
    
    const user = this.getCurrentUser();
    const domainConfig = this.appConfigService.getCurrentConfig()?.domainConfig;
    // Obtener tenantContext desde AppConfigService
    const tenantContext = this.appConfigService.getCurrentConfig()?.tenantConfig || null;

    if (!user || !domainConfig) {
      console.warn('[AUTH SERVICE] No se pudo obtener contexto para redirección, usando fallback');
      this.router.navigateByUrl('/admin');
      return;
    }

    const targetRoute = this.navigationService.navigateAfterLogin(
      user.roles || [],
      domainConfig,
      tenantContext
    );
    
    // Usar navigateByUrl para evitar recarga completa de la aplicación
    this.router.navigateByUrl(targetRoute);
    console.log('[AUTH SERVICE] Redirección post-login exitosa a:', targetRoute);
  }

  // Clear stored tokens
  private clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  // Decode JWT token to extract payload
  private decodeJwtToken(token: string): any {
    try {
      const payload = token.split('.')[1];
      const decodedPayload = atob(payload);
      return JSON.parse(decodedPayload);
    } catch (error) {
      console.error('Error decoding JWT token:', error);
      return null;
    }
  }
}
