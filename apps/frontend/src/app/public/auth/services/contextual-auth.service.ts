import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { DomainDetectorService } from '../../../core/services/domain-detector.service';
import { TenantConfigService } from '../../../core/services/tenant-config.service';
import { AppEnvironment, DomainConfig } from '../../../core/models/domain-config.interface';

export interface AuthContext {
  type: AppEnvironment;
  branding: any;
  organization?: string;
  store?: string;
  allowedRoles: string[];
  redirectUrl: string;
  authEndpoints: {
    login: string;
    register: string;
    logout: string;
    refresh: string;
  };
}

export interface ContextualLoginData {
  email: string;
  password: string;
  organizationSlug?: string;
  storeSlug?: string;
  context: AppEnvironment;
}

@Injectable({
  providedIn: 'root'
})
export class ContextualAuthService {
  private authContextSubject = new BehaviorSubject<AuthContext | null>(null);
  public authContext$ = this.authContextSubject.asObservable();

  constructor(
    private domainDetector: DomainDetectorService,
    private tenantConfig: TenantConfigService,
    private http: HttpClient
  ) {}

  /**
   * Obtiene el contexto de autenticación basado en el dominio actual
   */
  async getAuthContext(): Promise<AuthContext> {
    try {
      const domainConfig = await this.domainDetector.detectDomain();
      const tenantConfig = this.tenantConfig.getCurrentTenantConfig();
      
      const authContext: AuthContext = {
        type: domainConfig.environment,
        branding: tenantConfig?.branding || {},
        organization: domainConfig.organizationSlug,
        store: domainConfig.storeSlug,
        allowedRoles: this.getAllowedRoles(domainConfig.environment),
        redirectUrl: this.getPostLoginRedirect(domainConfig.environment),
        authEndpoints: this.getAuthEndpoints(domainConfig)
      };

      this.authContextSubject.next(authContext);
      return authContext;

    } catch (error) {
      console.error('[CONTEXTUAL AUTH] Error getting auth context:', error);
      throw error;
    }
  }

  /**
   * Realiza login contextual basado en el dominio
   */
  login(loginData: ContextualLoginData): Observable<any> {
    const endpoint = this.getLoginEndpoint(loginData.context);
    
    return this.http.post(endpoint, {
      email: loginData.email,
      password: loginData.password,
      organizationSlug: loginData.organizationSlug,
      storeSlug: loginData.storeSlug
    }).pipe(
      tap((response: any) => {
        // Guardar tokens y datos de usuario
        this.storeAuthData(response);
      }),
      catchError(error => {
        console.error('[CONTEXTUAL AUTH] Login error:', error);
        throw error;
      })
    );
  }

  /**
   * Registro contextual basado en el dominio
   */
  register(registerData: any): Observable<any> {
    const endpoint = this.getRegisterEndpoint(registerData.context);
    
    return this.http.post(endpoint, registerData).pipe(
      catchError(error => {
        console.error('[CONTEXTUAL AUTH] Register error:', error);
        throw error;
      })
    );
  }

  /**
   * Cierra sesión contextual
   */
  logout(): Observable<any> {
    const authContext = this.authContextSubject.value;
    const endpoint = authContext?.authEndpoints.logout || '/api/auth/logout';
    
    return this.http.post(endpoint, {}).pipe(
      tap(() => {
        this.clearAuthData();
      }),
      catchError(error => {
        console.error('[CONTEXTUAL AUTH] Logout error:', error);
        // Limpiar datos localmente incluso si falla el logout remoto
        this.clearAuthData();
        throw error;
      })
    );
  }

  /**
   * Verifica si el usuario actual tiene permisos para el contexto actual
   */
  hasContextPermission(userRoles: string[]): boolean {
    const authContext = this.authContextSubject.value;
    if (!authContext) return false;

    return userRoles.some(role => 
      authContext.allowedRoles.includes(role)
    );
  }

  /**
   * Obtiene los roles permitidos para el entorno actual
   */
  private getAllowedRoles(environment: AppEnvironment): string[] {
    switch(environment) {
      case AppEnvironment.VENDIX_LANDING:
      case AppEnvironment.VENDIX_ADMIN:
        return ['super_admin', 'admin', 'owner'];
      
      case AppEnvironment.ORG_LANDING:
      case AppEnvironment.ORG_ADMIN:
        return ['owner', 'admin', 'manager', 'customer'];
      
      case AppEnvironment.STORE_ECOMMERCE:
      case AppEnvironment.STORE_ADMIN:
        return ['owner', 'admin', 'manager', 'employee', 'customer'];
      
      default:
        return [];
    }
  }

  /**
   * Obtiene la URL de redirección post-login
   */
  private getPostLoginRedirect(environment: AppEnvironment): string {
    switch(environment) {
      case AppEnvironment.VENDIX_LANDING:
      case AppEnvironment.VENDIX_ADMIN:
        return '/super-admin';
      
      case AppEnvironment.ORG_LANDING:
      case AppEnvironment.ORG_ADMIN:
        return '/organization-admin';
      
      case AppEnvironment.STORE_ECOMMERCE:
      case AppEnvironment.STORE_ADMIN:
        return '/store-admin';
      
      default:
        return '/';
    }
  }

  /**
   * Obtiene los endpoints de autenticación basados en el dominio
   */
  private getAuthEndpoints(domainConfig: DomainConfig): AuthContext['authEndpoints'] {
    const base = '/api/auth';
    
    if (domainConfig.organizationSlug && domainConfig.storeSlug) {
      // Autenticación de tienda específica
      return {
        login: `${base}/store/${domainConfig.organizationSlug}/${domainConfig.storeSlug}/login`,
        register: `${base}/store/${domainConfig.organizationSlug}/${domainConfig.storeSlug}/register`,
        logout: `${base}/logout`,
        refresh: `${base}/refresh`
      };
    } else if (domainConfig.organizationSlug) {
      // Autenticación de organización
      return {
        login: `${base}/organization/${domainConfig.organizationSlug}/login`,
        register: `${base}/organization/${domainConfig.organizationSlug}/register`,
        logout: `${base}/logout`,
        refresh: `${base}/refresh`
      };
    } else {
      // Autenticación global de Vendix
      return {
        login: `${base}/login`,
        register: `${base}/register`,
        logout: `${base}/logout`,
        refresh: `${base}/refresh`
      };
    }
  }

  /**
   * Obtiene el endpoint de login específico
   */
  private getLoginEndpoint(environment: AppEnvironment): string {
    const authContext = this.authContextSubject.value;
    return authContext?.authEndpoints.login || '/api/auth/login';
  }

  /**
   * Obtiene el endpoint de registro específico
   */
  private getRegisterEndpoint(environment: AppEnvironment): string {
    const authContext = this.authContextSubject.value;
    return authContext?.authEndpoints.register || '/api/auth/register';
  }

  /**
   * Almacena datos de autenticación
   */
  private storeAuthData(authResponse: any): void {
    if (authResponse.access_token) {
      localStorage.setItem('access_token', authResponse.access_token);
    }
    if (authResponse.refresh_token) {
      localStorage.setItem('refresh_token', authResponse.refresh_token);
    }
    if (authResponse.user) {
      localStorage.setItem('user_data', JSON.stringify(authResponse.user));
    }
  }

  /**
   * Limpia datos de autenticación
   */
  private clearAuthData(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_data');
    this.authContextSubject.next(null);
  }

  /**
   * Obtiene el token de acceso actual
   */
  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  /**
   * Verifica si el usuario está autenticado
   */
  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  /**
   * Obtiene datos del usuario actual
   */
  getCurrentUser(): any {
    const userData = localStorage.getItem('user_data');
    return userData ? JSON.parse(userData) : null;
  }

  /**
   * Actualiza el contexto de autenticación
   */
  updateAuthContext(context: Partial<AuthContext>): void {
    const currentContext = this.authContextSubject.value;
    if (currentContext) {
      this.authContextSubject.next({ ...currentContext, ...context });
    }
  }
}