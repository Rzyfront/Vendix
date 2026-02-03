import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  DomainConfig,
  DomainResolution,
  DomainResolutionResponse,
} from '../models/domain-config.interface';
import { AppType } from '../models/environment.enum';
import { superAdminRoutes } from '../../routes/private/super_admin.routes';
import { vendixLandingPublicRoutes } from '../../routes/public/vendix_landing.public.routes';
import { orgLandingPublicRoutes } from '../../routes/public/org_landing.public.routes';
import { storeEcommercePublicRoutes } from '../../routes/public/store_ecommerce.public.routes';
import { storeLandingPublicRoutes } from '../../routes/public/store_landing.public.routes';
import { defaultPublicRoutes } from '../../routes/public/default.public.routes';
import { orgAdminRoutes } from '../../routes/private/org_admin.routes';
import { storeAdminRoutes } from '../../routes/private/store_admin.routes';
import { ecommerceRoutes } from '../../routes/private/ecommerce.routes';
import { BrandingConfig } from '../models/tenant-config.interface';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';
import { Routes } from '@angular/router';
import { ThemeService } from './theme.service';

// Alias for backwards compatibility
const AppEnvironment = AppType;

export interface LayoutConfig {
  name: string;
  component: string;
  allowedEnvironments: AppType[];
  allowedRoles: string[];
}
export interface AppConfig {
  environment: AppType;
  domainConfig: DomainConfig;
  routes: Routes;
  layouts: LayoutConfig[];
  branding: BrandingConfig;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private http = inject(HttpClient);
  private themeService = inject(ThemeService);
  private router = inject(Router);

  async setupConfig(): Promise<AppConfig> {
    console.log('🔍 [AppConfigService] ===== setupConfig() START =====');

    // 1. Detectar la configuración base del dominio.
    let domainConfig = await this.detectDomain();
    const domainAppType = domainConfig.environment; // Guardar el app_type original del dominio

    console.log('[AppConfigService] Domain detected:', {
      hostname: domainConfig.hostname,
      environment: domainConfig.environment,
      domainType: domainConfig.domainType,
    });

    // 2. Revisar si hay un entorno de usuario guardado (de un login previo).
    const cachedUserEnv = this.getCachedUserEnvironment();
    const cachedDomainEnv = this.getCachedDomainAppType();

    console.log('[AppConfigService] Cached environments:', {
      cachedUserEnv,
      cachedDomainEnv,
      domainAppType,
      fromLocalStorage: typeof localStorage !== 'undefined' ? localStorage.getItem('vendix_user_environment') : 'localStorage unavailable',
      loggedOutFlag: typeof localStorage !== 'undefined' ? localStorage.getItem('vendix_logged_out_recently') : 'N/A',
    });

    // 3. Lógica de Decisión de Entorno
    // Prioridad: 1) User environment (si está autenticado), 2) Domain app_type
    const isTargetAdmin =
      cachedUserEnv &&
      [
        AppType.ORG_ADMIN,
        AppType.STORE_ADMIN,
        AppType.VENDIX_ADMIN,
      ].includes(cachedUserEnv);

    console.log('[AppConfigService] Decision logic:', {
      cachedUserEnv,
      isTargetAdmin,
      hasValidAuthState: this.hasValidAuthState(),
    });

    // Solo usar el user environment si hay una sesión válida
    if (cachedUserEnv && isTargetAdmin && this.hasValidAuthState()) {
      console.log('[AppConfigService] ✅ ADMIN user authenticated: setting environment to', cachedUserEnv);
      domainConfig.environment = cachedUserEnv;
    } else {
      // Sin sesión válida o sin user env: usar el domain app_type
      console.log('[AppConfigService] ⚠️ Using domain app_type:', domainAppType);
      domainConfig.environment = domainAppType;
    }

    // 4. Construir la configuración final con el entorno definitivo.
    const appConfig = this.buildAppConfig(domainConfig);
    console.log('[AppConfigService] Final App Config build:', {
      environment: appConfig.environment,
      domainConfigEnvironment: domainConfig.environment,
      store: domainConfig.store_id,
      org: domainConfig.organization_id,
    });
    this.cacheAppConfig(appConfig);
    console.log('🔍 [AppConfigService] ===== setupConfig() END =====');
    return appConfig;
  }

  public updateEnvironmentForUser(
    currentConfig: AppConfig,
    userAppEnvironment: string,
  ): AppConfig {
    const newEnv = userAppEnvironment as AppType;
    const domainConfig: DomainConfig = {
      ...currentConfig.domainConfig,
      environment: newEnv,
    };
    const newConfig = this.buildAppConfig(domainConfig);
    this.cacheUserEnvironment(newEnv);
    this.cacheAppConfig(newConfig);

    // Notify router of environment change
    this.notifyEnvironmentChange(newEnv);

    return newConfig;
  }

  private notifyEnvironmentChange(newEnv: AppType): void {
    // Navigate to reload the app with new environment
    // This is a workaround to properly update routes
    setTimeout(() => {
      this.router
        .navigate([], {
          queryParams: { env: newEnv, refresh: Date.now() },
        })
        .catch((error) => {
          console.error(
            '[AppConfigService] Error notifying environment change:',
            error,
          );
        });
    }, 100);
  }

  private buildAppConfig(domainConfig: DomainConfig): AppConfig {
    return {
      environment: domainConfig.environment,
      domainConfig,
      routes: this.resolveRoutes(domainConfig),
      layouts: [],
      branding: this.themeService.transformBrandingFromApi(
        domainConfig.customConfig?.branding || {},
      ),
    };
  }

  private resolveRoutes(domainConfig: DomainConfig): Routes {
    console.log('🔀 [AppConfigService] resolveRoutes() START', {
      environment: domainConfig.environment,
    });

    const publicRoutes = this.resolvePublicRoutes(domainConfig);
    const privateRoutes = this.resolvePrivateRoutes(domainConfig);

    console.log('🔀 [AppConfigService] resolveRoutes() result:', {
      publicRoutesCount: publicRoutes.length,
      privateRoutesCount: privateRoutes.length,
      totalRoutes: publicRoutes.length + privateRoutes.length,
      publicFirstPath: publicRoutes[0]?.path,
      privateFirstPath: privateRoutes[0]?.path,
    });

    // 🔥 FIX: Para entornos ADMIN, si el usuario está autenticado y visita /,
    // redirigir al dashboard correspondiente
    const isAdminEnvironment = [
      AppType.STORE_ADMIN,
      AppType.ORG_ADMIN,
      AppType.VENDIX_ADMIN,
    ].includes(domainConfig.environment);

    let finalRoutes = [...publicRoutes, ...privateRoutes];

    if (isAdminEnvironment) {
      // Verificar si ya existe una ruta para '/' en las rutas públicas
      const hasRootRoute = publicRoutes.some(r => r.path === '' || r.path === '/');
      const hasAuthState = this.hasValidAuthState();

      console.log('🔀 [AppConfigService] Admin environment detected:', {
        hasRootRoute,
        hasAuthState,
      });

      // Si hay ruta raíz en públicas Y usuario está autenticado, agregar redirección prioritaria
      if (hasRootRoute && hasAuthState) {
        const dashboardPath = this.getDashboardPathForEnvironment(domainConfig.environment);
        console.log('🔀 [AppConfigService] Adding authenticated redirect to dashboard:', dashboardPath);

        // Agregar redirección al inicio (para que tenga prioridad)
        finalRoutes.unshift({
          path: '',
          redirectTo: dashboardPath,
          pathMatch: 'full',
        });
      }
    }

    return finalRoutes;
  }

  /**
   * Check if user has valid auth state in localStorage
   */
  private hasValidAuthState(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return false;

      const parsed = JSON.parse(authState);
      return !!(parsed?.user && parsed?.tokens?.access_token);
    } catch {
      return false;
    }
  }

  /**
   * Get the dashboard path for a given environment
   */
  private getDashboardPathForEnvironment(env: AppType): string {
    switch (env) {
      case AppType.STORE_ADMIN:
        return '/admin/dashboard';
      case AppType.ORG_ADMIN:
        return '/admin/dashboard';
      case AppType.VENDIX_ADMIN:
        return '/superadmin/dashboard';
      default:
        return '/admin/dashboard';
    }
  }

  private resolvePublicRoutes(domainConfig: DomainConfig): Routes {
    console.log('🔀 [AppConfigService] resolvePublicRoutes()', {
      environment: domainConfig.environment,
    });

    let routes: Routes;
    switch (domainConfig.environment) {
      case AppType.VENDIX_LANDING:
        routes = vendixLandingPublicRoutes;
        break;
      case AppType.ORG_LANDING:
        routes = orgLandingPublicRoutes;
        break;
      case AppType.STORE_ECOMMERCE:
        routes = storeEcommercePublicRoutes;
        break;
      case AppType.STORE_LANDING:
        routes = storeLandingPublicRoutes;
        break;
      default:
        routes = defaultPublicRoutes;
    }

    console.log('🔀 [AppConfigService] Public routes selected:', {
      routesCount: routes.length,
      firstRoute: routes[0],
    });

    return routes;
  }

  private resolvePrivateRoutes(domainConfig: DomainConfig): Routes {
    console.log('🔀 [AppConfigService] resolvePrivateRoutes()', {
      environment: domainConfig.environment,
    });

    let routes: Routes;
    switch (domainConfig.environment) {
      case AppType.VENDIX_ADMIN:
        routes = superAdminRoutes;
        break;
      case AppType.ORG_ADMIN:
        routes = orgAdminRoutes;
        break;
      case AppType.STORE_ADMIN:
        routes = storeAdminRoutes;
        break;
      case AppType.STORE_ECOMMERCE:
        routes = ecommerceRoutes;
        break;
      default:
        routes = [];
    }

    console.log('🔀 [AppConfigService] Private routes selected:', {
      routesCount: routes.length,
      firstRoute: routes[0],
    });

    return routes;
  }

  private async detectDomain(hostname?: string): Promise<DomainConfig> {
    const rawHostname =
      hostname ||
      (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const currentHostname = this.cleanHostname(rawHostname);
    const domainInfo = await this.resolveDomainFromAPI(currentHostname);
    if (!domainInfo) throw new Error(`Domain ${currentHostname} not found`);
    return this.buildDomainConfig(currentHostname, domainInfo);
  }

  private cleanHostname(hostname: string): string {
    // Remover el subdominio www si está presente
    if (hostname.startsWith('www.')) {
      return hostname.substring(4);
    }
    return hostname;
  }

  private async resolveDomainFromAPI(
    hostname: string,
  ): Promise<DomainResolution | null> {
    console.log('[AppConfigService] resolveDomainFromAPI() calling:', {
      url: `${environment.apiUrl}/public/domains/resolve/${hostname}`,
    });

    const response = await this.http
      .get<DomainResolutionResponse>(
        `${environment.apiUrl}/public/domains/resolve/${hostname}`,
      )
      .pipe(
        catchError((error) => {
          console.error('[AppConfigService] Domain API error:', error);
          return of(null);
        })
      )
      .toPromise();

    const domainInfo = response?.data ?? null;

    console.log('[AppConfigService] Domain API response:', {
      success: response?.success,
      hasData: !!domainInfo,
      domainType: domainInfo?.domain_type,
      app: domainInfo?.app,
      fullResponse: response,
    });

    return domainInfo;
  }

  private buildDomainConfig(
    hostname: string,
    domainInfo: DomainResolution,
  ): DomainConfig {
    console.log('[AppConfigService] buildDomainConfig() input:', {
      hostname,
      domainType: domainInfo.domain_type,
      app: domainInfo.app,
      organizationSlug: domainInfo.organization_slug,
      storeSlug: domainInfo.store_slug,
      isVendixDomain: domainInfo.organization_slug === 'vendix-corp',
      hasBranding: !!domainInfo.branding,
      hasEcommerce: !!domainInfo.ecommerce,
      hasPublication: !!domainInfo.publication,
    });

    // NUEVO ESTÁNDAR: Usar domainInfo.app (única fuente de verdad)
    const appType = domainInfo.app;
    const normalizedEnv = this.normalizeEnvironment(appType);

    const result: DomainConfig = {
      hostname,
      domainType: domainInfo.domain_type,
      environment: normalizedEnv,
      organization_slug: domainInfo.organization_slug,
      store_slug: domainInfo.store_slug,
      organization_id: domainInfo.organization_id,
      store_id: domainInfo.store_id,
      // NUEVO: customConfig ahora incluye datos desde store_settings
      customConfig: {
        // NUEVO: Branding desde store_settings (prioridad) o config.branding (fallback)
        branding: domainInfo.branding || domainInfo.config?.branding,
        fonts: domainInfo.fonts,
        ecommerce: domainInfo.ecommerce,
        publication: domainInfo.publication,
        security: domainInfo.config?.security,
      },
      isVendixDomain: domainInfo.organization_slug === 'vendix-corp',
    };

    console.log('[AppConfigService] buildDomainConfig() output:', {
      environment: result.environment,
      domainType: result.domainType,
      hasBranding: !!result.customConfig?.branding,
    });

    // Cache domain's original app_type (immutable, survives logout)
    this.cacheDomainAppType(normalizedEnv);

    return result;
  }

  private normalizeEnvironment(env: string): AppType {
    console.log('[AppConfigService] normalizeEnvironment() input:', {
      env,
      envType: typeof env,
      envLength: env?.length,
      isEmpty: env === '',
      isNull: env === null,
      isUndefined: env === undefined,
    });

    if (!env) {
      console.warn('⚠️ [AppConfigService] normalizeEnvironment(): env is falsy, returning VENDIX_LANDING as fallback');
      return AppType.VENDIX_LANDING;
    }
    const normalized = env.toUpperCase() as AppType;
    console.log('[AppConfigService] normalizeEnvironment() output:', normalized);
    return normalized;
  }

  private getCachedUserEnvironment(): AppType | null {
    try {
      console.log('[AppConfigService] getCachedUserEnvironment() START');
      if (typeof localStorage === 'undefined') {
        console.warn('[AppConfigService] localStorage is undefined');
        return null;
      }

      // 🔒 SECURITY CHECK: Verificar si el usuario acaba de cerrar sesión recientemente
      const loggedOutRecently = localStorage.getItem(
        'vendix_logged_out_recently',
      );

      console.log('[AppConfigService] Checking logout flag:', {
        hasLoggedOutFlag: !!loggedOutRecently,
        logoutFlagValue: loggedOutRecently,
      });

      if (loggedOutRecently) {
        const logoutTime = parseInt(loggedOutRecently);
        const currentTime = Date.now();
        const timeDiff = currentTime - logoutTime;

        console.log('[AppConfigService] Logout flag found:', {
          logoutTime,
          currentTime,
          timeDiff,
          timeDiffSeconds: Math.floor(timeDiff / 1000),
          thresholdMs: 30000,
          willIgnore: timeDiff < 30000,
        });

        // Si el logout fue hace menos de 30 segundos, ignorar el environment cachado
        if (currentTime - logoutTime < 30000) {
          console.warn('🔒 Recent logout detected (< 30s), ignoring cached environment');
          localStorage.removeItem('vendix_user_environment');
          localStorage.removeItem('vendix_logged_out_recently');
          return null;
        }
        // Limpiar bandera si pasó más tiempo
        console.log('[AppConfigService] Logout flag expired (> 30s), clearing flag');
        localStorage.removeItem('vendix_logged_out_recently');
      }

      const cachedEnv = localStorage.getItem(
        'vendix_user_environment',
      ) as AppType | null;

      console.log('[AppConfigService] Returning cached environment:', {
        cachedEnv,
        cachedEnvType: typeof cachedEnv,
      });

      return cachedEnv;
    } catch (e) {
      console.error('[AppConfigService] Error in getCachedUserEnvironment():', e);
      return null;
    }
  }

  private cacheUserEnvironment(env: AppType): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_user_environment', env);
    } catch (e) { }
  }

  /**
   * Cache the domain's original app_type (immutable, survives logout)
   */
  private cacheDomainAppType(env: AppType): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_domain_app_type', env);
    } catch (e) { }
  }

  /**
   * Get the cached domain app_type (used as fallback after logout)
   */
  private getCachedDomainAppType(): AppType | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem('vendix_domain_app_type') as AppType | null;
    } catch (e) {
      return null;
    }
  }

  private cacheAppConfig(config: AppConfig): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_app_config', JSON.stringify(config));
    } catch (e) { }
  }
}
