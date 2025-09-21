import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthFacade } from '../store/auth/auth.facade';
import { TenantFacade } from '../store/tenant/tenant.facade';
import * as AuthActions from '../store/auth/auth.actions';
import { environment } from '../../../environments/environment';

export interface LoginDto {
  email: string;
  password: string;
  storeSlug?: string;
  organizationSlug?: string;
}

export interface RegisterOwnerDto {
  organizationName: string;
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

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  isActive: boolean;
  emailVerified: boolean;
}

export interface BackendUser {
  id: number;
  username: string;
  email: string;
  state: string;
  last_login: string;
  failed_login_attempts: number;
  locked_until: string | null;
  email_verified: boolean;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  onboarding_completed: boolean;
  organization_id: number;
  user_roles: Array<{
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
      role_permissions: any[];
    };
  }>;
  organizations: any;
}

export interface AuthResponse {
  message: string;
  data: {
    access_token: string;
    refresh_token: string;
    user: BackendUser;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/auth`;

  constructor(
    private http: HttpClient,
    private router: Router,
    private store: Store,
    private authFacade: AuthFacade,
    private tenantFacade: TenantFacade
  ) {}

  // Login - auto-populates organizationSlug/storeSlug from current domain
  login(loginDto: LoginDto): Observable<AuthResponse> {
    // Auto-populate organizationSlug/storeSlug from current domain if not provided
    const enrichedLoginDto = { ...loginDto };

    if (!enrichedLoginDto.organizationSlug && !enrichedLoginDto.storeSlug) {
      const currentDomain = this.tenantFacade.getCurrentDomainConfig();
      if (currentDomain) {
        enrichedLoginDto.organizationSlug = currentDomain.organizationSlug;
        enrichedLoginDto.storeSlug = currentDomain.storeSlug;
      }
    }

    return this.http.post<AuthResponse>(`${this.API_URL}/login`, enrichedLoginDto)
      .pipe(
        tap((response: AuthResponse) => {
          if (response.data) {
            console.log('Login response received:', response);
            
            // Transform backend user object to frontend User interface
            const backendUser = response.data.user;
            const frontendUser: User = {
              id: backendUser.id.toString(),
              email: backendUser.email,
              firstName: backendUser.first_name,
              lastName: backendUser.last_name,
              roles: backendUser.user_roles?.map((ur: any) => ur.roles.name) || [],
              isActive: backendUser.state === 'active',
              emailVerified: backendUser.email_verified
            };

            console.log('Transformed user:', frontendUser);

            // Store tokens and user data
            localStorage.setItem('access_token', response.data.access_token);
            localStorage.setItem('refresh_token', response.data.refresh_token);
            localStorage.setItem('user', JSON.stringify(frontendUser));

            console.log('Tokens and user data stored in localStorage');

            // Update auth store - this will trigger the navigation in effects
            this.store.dispatch(AuthActions.loginSuccess({
              user: frontendUser,
              tokens: {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token
              }
            }));

            console.log('Auth store updated with login success action');
          }
        })
      );
  }

  // Register Owner
  registerOwner(registerData: RegisterOwnerDto): Observable<any> {
    return this.http.post(`${this.API_URL}/register-owner`, registerData);
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
  forgotPassword(email: string, organizationSlug: string): Observable<any> {
    return this.http.post(`${this.API_URL}/forgot-password`, { email, organization_slug: organizationSlug });
  }

  // Reset Password
  resetPassword(token: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.API_URL}/reset-password`, { token, newPassword });
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
    return localStorage.getItem('access_token');
  }

  // Get refresh token
  getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  // Redirect after login based on user role
  redirectAfterLogin(): void {
    console.log('Redirecting to admin dashboard...');
    // Always redirect to admin dashboard after login
    this.router.navigate(['/admin/dashboard']).then(success => {
      if (success) {
        console.log('Successfully navigated to admin dashboard');
      } else {
        console.error('Failed to navigate to admin dashboard');
      }
    });
  }

  // Clear stored tokens
  private clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }
}
