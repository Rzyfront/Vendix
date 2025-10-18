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

      // 4. Handle initial navigation after routes are configured
      await this.handleInitialNavigation(appConfig);
      
      console.log('[APP INITIALIZER] Initialization completed successfully.');

    } catch (error) {
      console.error('[APP INITIALIZER] Critical error during initialization:', error);
      this.initializationError = error;
      // Handle critical error, maybe show a generic error page
    }
  }

  /**
   * Maneja la navegación inicial después de que las rutas están configuradas
   */
  private async handleInitialNavigation(appConfig: any): Promise<void> {
    // Esperar un tick del event loop para asegurar que el router ha procesado las rutas dinámicas
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const currentUrl = window.location.pathname;
    console.log('[APP INITIALIZER] Handling initial navigation for URL:', currentUrl);
    console.log('[APP INITIALIZER] Current router config:', this.router.config);

    // Si ya estamos en una ruta válida, no hacer nada
    if (currentUrl !== '/' && this.routeManager.isRouteAvailable(currentUrl)) {
      console.log('[APP INITIALIZER] Current URL is valid, no navigation needed');
      return;
    }

    // Para usuarios autenticados, redirigir a su dashboard apropiado
    const isAuthenticated = this.authFacade.isLoggedIn();
    if (isAuthenticated) {
      const user = this.authFacade.getCurrentUser();
      const userRoles = user?.roles || [];
      const targetRoute = this.navigationService.redirectAfterLogin(
        userRoles,
        appConfig.domainConfig,
        appConfig.tenantConfig
      );
      
      console.log('[APP INITIALIZER] Authenticated user, navigating to:', targetRoute);
      console.log('[APP INITIALIZER] Available routes:', this.routeManager.getCurrentRoutes());
      
      // Verificar que la ruta objetivo esté disponible antes de navegar
      if (this.routeManager.isRouteAvailable(targetRoute)) {
        await this.router.navigateByUrl(targetRoute, { replaceUrl: true });
      } else {
        console.error('[APP INITIALIZER] Target route not available:', targetRoute);
        // Fallback a la ruta por defecto del entorno
        const fallbackRoute = this.navigationService.getDefaultRouteForEnvironment(appConfig.environment);
        console.log('[APP INITIALIZER] Using fallback route:', fallbackRoute);
        await this.router.navigateByUrl(fallbackRoute, { replaceUrl: true });
      }
      return;
    }

    // Para usuarios no autenticados, navegar a la ruta por defecto del entorno
    const defaultRoute = this.navigationService.getDefaultRouteForEnvironment(appConfig.environment);
    console.log('[APP INITIALIZER] Non-authenticated user, navigating to default route:', defaultRoute);
    console.log('[APP INITIALIZER] Available routes:', this.routeManager.getCurrentRoutes());
    
    // Verificar que la ruta por defecto esté disponible antes de navegar
    if (this.routeManager.isRouteAvailable(defaultRoute)) {
      await this.router.navigateByUrl(defaultRoute, { replaceUrl: true });
    } else {
      console.error('[APP INITIALIZER] Default route not available:', defaultRoute);
      // Fallback absoluto a la raíz
      await this.router.navigateByUrl('/', { replaceUrl: true });
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
