import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, throwError, timer } from 'rxjs';
import { catchError, retry } from 'rxjs/operators';
import {
  DomainConfig,
  DomainResolution,
  DomainResolutionResponse,
} from '../models/domain-config.interface';
import { AppType } from '../models/environment.enum';
import type { DomainResolutionErrorKind } from '../store/config/config.actions';
import { superAdminRoutes } from '../../routes/private/super_admin.routes';
import { vendixLandingPublicRoutes } from '../../routes/public/vendix_landing.public.routes';
import { orgLandingPublicRoutes } from '../../routes/public/org_landing.public.routes';
import { storeEcommercePublicRoutes } from '../../routes/public/store_ecommerce.public.routes';
import { storeLandingPublicRoutes } from '../../routes/public/store_landing.public.routes';
import { defaultPublicRoutes } from '../../routes/public/default.public.routes';
import { orgAdminRoutes } from '../../routes/private/org_admin.routes';
import { storeAdminRoutes } from '../../routes/private/store_admin.routes';
import { storeDeliveryRoutes } from '../../routes/private/store_delivery.routes';
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

/**
 * Error tipado de resolución de dominio/app_type. Transporta el `kind`
 * (`not_found` | `transient`) para que la UI decida entre "no encontrado" y
 * "reintentar". La resolución NUNCA se degrada a VENDIX_LANDING ante fallo;
 * en su lugar propaga este error.
 */
export class DomainResolutionError extends Error {
  constructor(
    public readonly kind: DomainResolutionErrorKind,
    message?: string,
  ) {
    super(message ?? `Domain resolution failed (${kind})`);
    this.name = 'DomainResolutionError';
  }
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private http = inject(HttpClient);
  private themeService = inject(ThemeService);
  private router = inject(Router);

  async setupConfig(): Promise<AppConfig> {
    // 1. Detectar la configuración base del dominio.
    let domainConfig = await this.detectDomain();
    const domainAppType = domainConfig.environment;

    // 2. Revisar si hay un entorno de usuario guardado (de un login previo).
    const cachedUserEnv = this.getCachedUserEnvironment();
    const cachedDomainEnv = this.getCachedDomainAppType();

    // 3. Lógica de Decisión de Entorno
    // Prioridad: 1) User environment (si está autenticado), 2) Domain app_type
    const isTargetAdmin =
      cachedUserEnv &&
      [
        AppType.ORG_ADMIN,
        AppType.STORE_ADMIN,
        AppType.VENDIX_ADMIN,
        AppType.STORE_DELIVERY,
      ].includes(cachedUserEnv);

    // Solo usar el user environment si hay una sesión válida
    if (cachedUserEnv && isTargetAdmin && this.hasValidAuthState()) {
      domainConfig.environment = cachedUserEnv;
    } else {
      domainConfig.environment = domainAppType;
    }

    // 4. Construir la configuración final con el entorno definitivo.
    const appConfig = this.buildAppConfig(domainConfig);
    this.cacheAppConfig(appConfig);
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
    const publicRoutes = this.resolvePublicRoutes(domainConfig);
    const privateRoutes = this.resolvePrivateRoutes(domainConfig);

    // 🔥 FIX: Para entornos ADMIN, si el usuario está autenticado y visita /,
    // redirigir al dashboard correspondiente
    const isAdminEnvironment = [
      AppType.STORE_ADMIN,
      AppType.ORG_ADMIN,
      AppType.VENDIX_ADMIN,
      AppType.STORE_DELIVERY,
    ].includes(domainConfig.environment);

    let finalRoutes = [...publicRoutes, ...privateRoutes];

    if (isAdminEnvironment) {
      // Verificar si ya existe una ruta para '/' en las rutas públicas
      const hasRootRoute = publicRoutes.some(
        (r) => r.path === '' || r.path === '/',
      );
      const hasAuthState = this.hasValidAuthState();

      // Si hay ruta raíz en públicas Y usuario está autenticado, agregar redirección prioritaria
      if (hasRootRoute && hasAuthState) {
        const dashboardPath = this.getDashboardPathForEnvironment(
          domainConfig.environment,
        );

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
      case AppType.STORE_DELIVERY:
        return '/repartos/pool';
      default:
        return '/admin/dashboard';
    }
  }

  private resolvePublicRoutes(domainConfig: DomainConfig): Routes {
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

    return routes;
  }

  private resolvePrivateRoutes(domainConfig: DomainConfig): Routes {
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
      case AppType.STORE_DELIVERY:
        routes = storeDeliveryRoutes;
        break;
      case AppType.STORE_ECOMMERCE:
        routes = ecommerceRoutes;
        break;
      default:
        routes = [];
    }

    return routes;
  }

  private async detectDomain(hostname?: string): Promise<DomainConfig> {
    // SSR: no real domain to resolve — return VENDIX_LANDING config directly
    if (typeof window === 'undefined' && !hostname) {
      return {
        hostname: 'vendix.store',
        domainType: 'PRIMARY',
        environment: AppType.VENDIX_LANDING,
        organization_slug: 'vendix',
        organization_name: 'Vendix Corp',
        store_slug: undefined,
        store_name: undefined,
        organization_id: undefined,
        store_id: undefined,
        store_logo_url: undefined,
        customConfig: {},
        isVendixDomain: true,
        isMainVendixDomain: true,
      } as DomainConfig;
    }

    const rawHostname =
      hostname ||
      (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const currentHostname = this.cleanHostname(rawHostname);
    // resolveDomainFromAPI devuelve una resolución válida o lanza un
    // DomainResolutionError tipado. Nunca retorna null silencioso.
    const domainInfo = await this.resolveDomainFromAPI(currentHostname);
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
  ): Promise<DomainResolution> {
    const response = await firstValueFrom(
      this.http
        .get<DomainResolutionResponse>(
          `${environment.apiUrl}/public/domains/resolve/${hostname}`,
        )
        .pipe(
          // Reintentar SOLO ante error transitorio (red/CORS/cert, 5xx,
          // timeout). Un 404 es definitivo: se re-lanza de inmediato sin
          // reintentar. Backoff incremental: 500ms, 1000ms, 2000ms.
          retry({
            count: 3,
            delay: (error: unknown, retryCount: number) => {
              if (this.classifyDomainError(error) === 'not_found') {
                return throwError(() => error);
              }
              const backoffMs = 500 * Math.pow(2, retryCount - 1);
              return timer(backoffMs);
            },
          }),
          // Agotados los reintentos (o ante 404): propagar Error tipado con
          // `kind` — NUNCA `of(null)` silencioso ni degradación a landing.
          catchError((error: unknown) =>
            throwError(
              () =>
                new DomainResolutionError(
                  this.classifyDomainError(error),
                  error instanceof HttpErrorResponse
                    ? `Domain API error ${error.status} for ${hostname}`
                    : `Domain API error for ${hostname}`,
                ),
            ),
          ),
        ),
    );

    const data = response?.data ?? null;
    if (!data) {
      // HTTP 200 sin payload de resolución → dominio no resoluble.
      throw new DomainResolutionError(
        'not_found',
        `Domain ${hostname} not found (empty resolution payload)`,
      );
    }
    return data;
  }

  /**
   * Clasifica un error de la resolución de dominio en un `kind` tipado.
   * - 404 → `not_found` (definitivo, no reintentar).
   * - status 0 (red/CORS/cert), >= 500, timeout o cualquier otro → `transient`.
   */
  private classifyDomainError(error: unknown): DomainResolutionErrorKind {
    if (error instanceof HttpErrorResponse) {
      return error.status === 404 ? 'not_found' : 'transient';
    }
    return 'transient';
  }

  private buildDomainConfig(
    hostname: string,
    domainInfo: DomainResolution,
  ): DomainConfig {
    // NUEVO ESTÁNDAR: Usar domainInfo.app (única fuente de verdad)
    const appType = domainInfo.app;
    const normalizedEnv = this.normalizeEnvironment(appType);

    const result: DomainConfig = {
      hostname,
      domainType: domainInfo.domain_type,
      environment: normalizedEnv,
      organization_slug: domainInfo.organization_slug,
      organization_name: domainInfo.organization_name,
      store_slug: domainInfo.store_slug,
      store_name: domainInfo.store_name,
      organization_id: domainInfo.organization_id,
      store_id: domainInfo.store_id,
      // NUEVO: customConfig ahora incluye datos desde store_settings
      store_logo_url: domainInfo.store_logo_url,
      customConfig: {
        // NUEVO: Branding desde store_settings (prioridad) o config.branding (fallback)
        branding: {
          ...(domainInfo.branding || domainInfo.config?.branding),
          // Inyectar store_logo_url en branding.logo_url si no existe
          logo_url:
            (domainInfo.branding || domainInfo.config?.branding)?.logo_url ||
            domainInfo.store_logo_url,
        },
        fonts: domainInfo.fonts,
        ecommerce: domainInfo.ecommerce,
        publication: domainInfo.publication,
        currency: domainInfo.currency,
        security: domainInfo.config?.security,
      },
      isVendixDomain: domainInfo.organization_slug === 'vendix',
      isMainVendixDomain:
        hostname === environment.vendixDomain ||
        hostname === `www.${environment.vendixDomain}`,
    };

    // Cache domain's original app_type (immutable, survives logout)
    this.cacheDomainAppType(normalizedEnv);

    return result;
  }

  private normalizeEnvironment(env: string): AppType {
    if (!env) {
      // El backend NO envió app_type: config inválida. NO degradamos a
      // VENDIX_LANDING; lo tratamos como error transitorio para permitir
      // reintento desde la UI.
      throw new DomainResolutionError(
        'transient',
        'Backend domain resolution returned empty app_type',
      );
    }
    const normalized = env.toUpperCase() as AppType;
    return normalized;
  }

  private getCachedUserEnvironment(): AppType | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      // 🔒 SECURITY CHECK: Verificar si el usuario acaba de cerrar sesión recientemente
      const loggedOutRecently = localStorage.getItem(
        'vendix_logged_out_recently',
      );

      if (loggedOutRecently) {
        const logoutTime = parseInt(loggedOutRecently);
        const currentTime = Date.now();
        const timeDiff = currentTime - logoutTime;

        // Si el logout fue hace menos de 30 segundos, ignorar el environment cachado
        if (currentTime - logoutTime < 30000) {
          localStorage.removeItem('vendix_user_environment');
          localStorage.removeItem('vendix_logged_out_recently');
          return null;
        }
        // Limpiar bandera si pasó más tiempo
        localStorage.removeItem('vendix_logged_out_recently');
      }

      const cachedEnv = localStorage.getItem(
        'vendix_user_environment',
      ) as AppType | null;

      return cachedEnv;
    } catch (e) {
      return null;
    }
  }

  private cacheUserEnvironment(env: AppType): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_user_environment', env);
    } catch (e) {}
  }

  /**
   * Cache the domain's original app_type (immutable, survives logout)
   */
  private cacheDomainAppType(env: AppType): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_domain_app_type', env);
    } catch (e) {}
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
    } catch (e) {}
  }
}
