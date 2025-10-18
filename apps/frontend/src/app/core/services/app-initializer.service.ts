import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthFacade } from '../store/auth/auth.facade';
import { AppConfigService } from './app-config.service';
import { AuthService } from './auth.service';
import { RouteManagerService } from './route-manager.service';
import { NavigationService } from './navigation.service';

@Injectable({
  providedIn: 'root'
})
export class AppInitializerService {
  private initializationError: any = null;

  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private appConfigService = inject(AppConfigService);
  private authService = inject(AuthService);
  private routeManager = inject(RouteManagerService);
  private navigationService = inject(NavigationService);

  async initializeApp(): Promise<void> {
    try {
      this.initializationError = null;
      console.log('[APP INITIALIZER] Starting initialization...');

      // 1. Load domain and user configuration
      const appConfig = await this.appConfigService.initializeApp();
      console.log('[APP INITIALIZER] App configuration resolved.');

      // 2. Set the dynamic routes in the router
      await this.routeManager.configureDynamicRoutes();
      console.log('[APP INITIALIZER] Dynamic routes configured.');

      // 3. Perform session validation for authenticated users
      const isAuthenticated = this.authFacade.isLoggedIn();
      if (isAuthenticated) {
        const user = this.authFacade.getCurrentUser();
        const userRoles = user?.roles || [];
        const userEnv = appConfig.environment;

        if (!this.authService.validateUserEnvironmentAccess(userRoles, userEnv)) {
          console.error(`[APP INITIALIZER] Invalid session. Clearing session.`);
          this.appConfigService.clearCache();
          window.location.reload();
          return; // Stop execution
        }
      }

      console.log('[APP INITIALIZER] Initialization completed successfully. Router will now perform initial navigation.');

    } catch (error) {
      console.error('[APP INITIALIZER] Critical error during initialization:', error);
      this.initializationError = error;
      // Handle critical error, maybe show a generic error page
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
