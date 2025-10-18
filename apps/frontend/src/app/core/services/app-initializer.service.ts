import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { AppConfigService } from './app-config.service';
import { AuthService } from './auth.service'; // Import AuthService
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';

@Injectable({
  providedIn: 'root'
})
export class AppInitializerService {
  private initializationError: any = null;

  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private appConfigService = inject(AppConfigService);
  private authService = inject(AuthService); // Inject AuthService

  async initializeApp(): Promise<void> {
    try {
      this.initializationError = null;
      console.log('[APP INITIALIZER] Starting simplified initialization flow');

      const isAuthenticated = this.checkPersistedAuth();
      console.log('[APP INITIALIZER] Persisted auth check:', isAuthenticated);

      const appConfig = await this.appConfigService.initializeApp();
      console.log('[APP INITIALIZER] App configuration resolved:', appConfig);

      if (isAuthenticated) {
        console.log('[APP INITIALIZER] User is authenticated, validating environment access...');
        const user = this.authFacade.getCurrentUser();
        const userRoles = user?.roles || [];
        const userEnv = appConfig.environment;

        if (!this.authService.validateUserEnvironmentAccess(userRoles, userEnv)) {
          console.error(`[APP INITIALIZER] Invalid session: User with roles [${userRoles.join(', ')}] cannot access environment ${userEnv}. Clearing session.`);
          this.appConfigService.clearCache();
          window.location.reload(); // Force a reload to a clean state
          return; // Stop further execution
        }

        await this.redirectAuthenticatedUser(appConfig.domainConfig);
      }

      console.log('[APP INITIALIZER] Application initialization completed successfully');

    } catch (error) {
      console.error('[APP INITIALIZER] Error during initialization:', error);
      this.initializationError = error;
    }
  }

  /**
   * Verifica si hay un usuario autenticado en el estado persistido
   */
  private checkPersistedAuth(): boolean {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsedState = JSON.parse(authState);
        const hasUser = !!parsedState.user;
        const hasTokens = !!parsedState.tokens?.accessToken;
        
        console.log('[APP INITIALIZER] Checking persisted auth:', { hasUser, hasTokens, user: parsedState.user?.email });
        
        if (hasUser && hasTokens) {
          // Dispatch action to restore auth state immediately
          this.authFacade.restoreAuthState(parsedState.user, parsedState.tokens, parsedState.permissions, parsedState.roles);
          return true;
        }
      }
    } catch (error) {
      console.warn('[APP INITIALIZER] Error checking persisted auth:', error);
    }

    // If no state was restored, ensure loading is set to false
    this.authFacade.setLoading(false);
    return false;
  }

  /**
   * Redirige al usuario autenticado a su entorno apropiado
   */
  private async redirectAuthenticatedUser(domainConfig: DomainConfig): Promise<void> {
    try {
      // Wait a bit for the auth state to be restored
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const user = this.authFacade.getCurrentUser();
      const userRole = this.authFacade.getCurrentUserRole();
      const isAuthenticated = this.authFacade.isLoggedIn();
      
      console.log('[APP INITIALIZER] Redirecting authenticated user:', {
        user: user?.email,
        userRole,
        isAuthenticated,
        currentPath: this.router.url,
        environment: domainConfig.environment
      });
      
      if (user && userRole && isAuthenticated) {
        // Only redirect if we're not already in the appropriate area
        const currentPath = this.router.url;
        const shouldRedirect = this.shouldRedirectUser(currentPath, userRole, domainConfig.environment);
        
        if (shouldRedirect) {
          // Use intelligent redirection based on environment and user roles
          const redirectPath = this.getPostLoginRedirectPath(domainConfig.environment, userRole);
          
          console.log('[APP INITIALIZER] Redirecting to:', redirectPath);
          this.router.navigate([redirectPath]);
        } else {
          console.log('[APP INITIALIZER] User already in appropriate area, no redirect needed');
        }
      } else {
        console.log('[APP INITIALIZER] Auth state not fully restored, skipping redirect');
      }
    } catch (error) {
      console.error('[APP INITIALIZER] Error redirecting authenticated user:', error);
    }
  }

  /**
   * Determina si el usuario necesita redirección basado en su ubicación actual y rol
   */
  private shouldRedirectUser(currentPath: string, userRole: string, environment: AppEnvironment): boolean {
    const adminRoles = ['super_admin', 'admin', 'owner', 'manager', 'supervisor'];
    const isAdmin = adminRoles.includes(userRole.toLowerCase());
    
    // No redirigir si ya está en el área apropiada
    if (isAdmin && currentPath.startsWith('/admin')) {
      return false;
    }
    
    if (userRole === 'super_admin' && currentPath.startsWith('/superadmin')) {
      return false;
    }
    
    if (userRole === 'customer' && (currentPath.startsWith('/account') || currentPath.startsWith('/shop'))) {
      return false;
    }
    
    // No redirigir desde rutas públicas específicas
    const publicRoutes = ['/auth/login', '/auth/register', '/auth/forgot-password', '/'];
    if (publicRoutes.includes(currentPath)) {
      return true;
    }
    
    return true;
  }

  /**
   * Obtiene la ruta de redirección post-login basada en el entorno y rol del usuario
   */
  private getPostLoginRedirectPath(environment: AppEnvironment, userRole: string): string {
    const adminRoles = ['super_admin', 'admin', 'owner', 'manager', 'supervisor'];
    const isAdmin = adminRoles.includes(userRole.toLowerCase());
    
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return userRole === 'super_admin' ? '/superadmin' : '/admin';
        
      case AppEnvironment.VENDIX_ADMIN:
        return userRole === 'super_admin' ? '/superadmin' : '/admin';
        
      case AppEnvironment.ORG_LANDING:
        return isAdmin ? '/admin' : '/shop';
        
      case AppEnvironment.ORG_ADMIN:
        return '/admin';
        
      case AppEnvironment.STORE_ADMIN:
        return '/admin';
        
      case AppEnvironment.STORE_ECOMMERCE:
        return isAdmin ? '/admin' : '/account';
        
      default:
        return '/';
    }
  }

  /**
   * Obtiene el error de inicialización si ocurrió
   */
  getInitializationError(): any {
    return this.initializationError;
  }

  /**
   * Verifica si la inicialización falló
   */
  hasInitializationError(): boolean {
    return this.initializationError !== null;
  }

  /**
   * Reinicia la aplicación (útil para cambios de configuración)
   */
  async reinitializeApp(): Promise<void> {
    console.log('[APP INITIALIZER] Reinitializing application...');
    
    // Reinicializar usando AppConfigService centralizado
    await this.appConfigService.reinitialize();
    await this.initializeApp();
  }

  /**
   * Verifica si la aplicación está completamente inicializada
   */
  isAppInitialized(): boolean {
    return this.appConfigService.isInitialized();
  }
}
