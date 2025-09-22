import { Injectable } from '@angular/core';
import { CanMatchFn, Router, UrlSegment, Route } from '@angular/router';
import { inject } from '@angular/core';
import { DomainDetectorService } from '../services/domain-detector.service';
import { TenantConfigService } from '../services/tenant-config.service';
import { ThemeService } from '../services/theme.service';
import { LayoutRouterService } from '../services/layout-router.service';

@Injectable({ providedIn: 'root' })
export class DomainAppGuardService {
  constructor(
    private readonly domainDetector: DomainDetectorService,
    private readonly tenantConfig: TenantConfigService,
    private readonly theme: ThemeService,
    private readonly layoutRouter: LayoutRouterService,
    private readonly router: Router
  ) {}

  async handle(segments: UrlSegment[]): Promise<boolean | import('@angular/router').UrlTree> {
    try {
      // Sólo actuar en la raíz. Si hay segmentos (p. ej. 'landing'), permitir.
      const atRoot = segments.length === 0;
      if (!atRoot) return true;

      // No hacer IO aquí: si no hay DomainConfig aún, permitir y dejar que APP_INITIALIZER lo resuelva
      const domain = this.tenantConfig.getCurrentDomainConfig();
      if (!domain) {
        return true;
      }

      // Decidir home pública (fallback)
      const target = this.layoutRouter.getHomeUrlFor(domain.environment, {
        organizationSlug: domain.organizationSlug,
        storeSlug: domain.storeSlug,
      });

      // En canMatch es más seguro devolver UrlTree; pero sólo como fallback cuando seguimos en raíz
      if (target && target !== '/') {
        return this.router.parseUrl(target);
      }
      return true;
    } catch (err) {
      console.error('[DomainAppGuard] Error resolving domain. Falling back to "/".', err);
      // Fallback seguro: permitir la coincidencia de esta ruta raíz
      return true;
    }
  }
}

export const DomainAppGuard: CanMatchFn = async (
  route: Route,
  segments: UrlSegment[]
) => {
  const svc = inject(DomainAppGuardService);
  return svc.handle(segments);
};
