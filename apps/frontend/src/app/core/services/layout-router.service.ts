import { Injectable } from '@angular/core';
import { AppEnvironment } from '../models/domain-config.interface';

type LayoutKey = 'superadmin' | 'admin' | 'pos' | 'storefront';

export interface PostLoginUserLike {
  roles?: string[]; // e.g., ['ADMIN','OWNER']
  preferredLayout?: LayoutKey | null;
}

@Injectable({ providedIn: 'root' })
export class LayoutRouterService {
  /** Devuelve la URL pública inicial según el entorno/app del dominio */
  getHomeUrlFor(
    environment: AppEnvironment,
    ctx?: { organizationSlug?: string | null; storeSlug?: string | null }
  ): string {
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        // Root '/' is LandingComponent via EnvMatchGuard
        return '/';
      case AppEnvironment.VENDIX_ADMIN:
        return '/superadmin';
      case AppEnvironment.ORG_LANDING:
        // Si hubiera landing específica por organización, podría ser '/organization/:slug'
        return '/';
      case AppEnvironment.ORG_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ECOMMERCE:
        return '/shop';
      default:
        return '/';
    }
  }

  /** Calcula la URL destino post-login según roles y preferencia de layout */
  computePostLoginUrl(
    user: PostLoginUserLike | null | undefined,
    environment: AppEnvironment | null | undefined,
    ctx?: { organizationSlug?: string | null; storeSlug?: string | null }
  ): string {
    const roles = (user?.roles || []).map(r => r.toLowerCase());
    const allowed = this.getAllowedLayoutsForRoles(roles);

    // preferencia del usuario si está permitida
    const pref = (user?.preferredLayout || null) as LayoutKey | null;
    let layout: LayoutKey | null = pref && allowed.includes(pref) ? pref : null;

    if (!layout) {
      layout = this.pickByPriority(allowed);
    }

    if (!layout) {
      // Sin layouts permitidos: enviar a storefront como fallback público
      return this.getHomeUrlFor(environment || AppEnvironment.VENDIX_LANDING, ctx);
    }

    return this.layoutToUrl(layout, ctx);
  }

  /** Convierte un layout a una URL base */
  layoutToUrl(layout: LayoutKey, _ctx?: { organizationSlug?: string | null; storeSlug?: string | null }): string {
    switch (layout) {
      case 'superadmin':
        return '/superadmin';
      case 'admin':
        return '/admin';
      case 'pos':
        return '/pos';
      case 'storefront':
        return '/shop';
      default:
        return '/';
    }
  }

  private getAllowedLayoutsForRoles(roles: string[]): LayoutKey[] {
    // Normalizamos roles del backend (lowercase) o frontend (uppercase)
    const has = (name: string) => roles.includes(name) || roles.includes(name.toLowerCase()) || roles.includes(name.toUpperCase());

    const allowed = new Set<LayoutKey>();

    if (has('super_admin')) {
      ['superadmin', 'admin', 'pos', 'storefront'].forEach(l => allowed.add(l as LayoutKey));
    }
    if (has('owner') || has('admin')) {
      ['admin', 'pos', 'storefront'].forEach(l => allowed.add(l as LayoutKey));
    }
    if (has('manager')) {
      ['admin', 'pos'].forEach(l => allowed.add(l as LayoutKey));
    }
    if (has('supervisor') || has('employee')) {
      allowed.add('pos');
    }
    if (has('customer')) {
      allowed.add('storefront');
    }

    return Array.from(allowed);
  }

  private pickByPriority(allowed: LayoutKey[]): LayoutKey | null {
    const priority: LayoutKey[] = ['superadmin', 'admin', 'pos', 'storefront'];
    for (const p of priority) {
      if (allowed.includes(p)) return p;
    }
    return null;
  }

  // Optional public helper for guards or components
  public isLayoutAllowed(roles: string[], layout: LayoutKey): boolean {
    return this.getAllowedLayoutsForRoles(roles).includes(layout);
  }
}
