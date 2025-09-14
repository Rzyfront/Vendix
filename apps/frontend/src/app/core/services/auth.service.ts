import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
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

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  isActive: boolean;
  emailVerified: boolean;
}

export interface AuthResponse {
  message: string;
  data: {
    access_token: string;
    refresh_token: string;
    user: User;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Check if user is already logged in
    this.checkStoredAuth();
  }

  private checkStoredAuth(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const token = localStorage.getItem('access_token');
    const user = localStorage.getItem('user');

    if (token && user) {
      try {
        const parsedUser = JSON.parse(user);
        this.currentUserSubject.next(parsedUser);
      } catch (error) {
        this.logout();
      }
    }
  }

  login(loginDto: LoginDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/login`, loginDto)
      .pipe(
        tap((response: AuthResponse) => {
          if (response.data && isPlatformBrowser(this.platformId)) {
            // Store tokens and user data
            localStorage.setItem('access_token', response.data.access_token);
            localStorage.setItem('refresh_token', response.data.refresh_token);
            localStorage.setItem('user', JSON.stringify(response.data.user));

            // Update current user subject
            this.currentUserSubject.next(response.data.user);
          }
        })
      );
  }

  registerOwner(registerData: RegisterOwnerDto): Observable<any> {
    return this.http.post(`${this.API_URL}/register-owner`, registerData);
  }

  logout(): void {
    // Clear local storage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
    }

    // Update current user subject
    this.currentUserSubject.next(null);

    // Redirect to landing page
    this.router.navigate(['/']);
  }

  refreshToken(): Observable<any> {
    if (!isPlatformBrowser(this.platformId)) {
      return this.http.post(`${this.API_URL}/refresh`, { refresh_token: null });
    }
    const refreshToken = localStorage.getItem('refresh_token');
    return this.http.post(`${this.API_URL}/refresh`, { refresh_token: refreshToken });
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isLoggedIn(): boolean {
    return this.currentUserSubject.value !== null;
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.roles?.includes('ADMIN') || false;
  }

  getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem('access_token');
  }
  redirectAfterLogin(): void {
    const user = this.getCurrentUser();
    if (user?.roles?.includes('ADMIN')) {
      this.router.navigate(['/admin/dashboard']);
    } else {
      // For regular users, redirect to store or landing
      this.router.navigate(['/']);
    }
  }
}
