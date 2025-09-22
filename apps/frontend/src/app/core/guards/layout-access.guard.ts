import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { LayoutRouterService } from '../services/layout-router.service';

@Injectable({ providedIn: 'root' })
export class LayoutAccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthFacade,
    private readonly layoutRouter: LayoutRouterService,
    private readonly router: Router
  ) {}

  async canActivate(route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): Promise<boolean> {
    const isAuthenticated = await firstValueFrom(this.auth.isAuthenticated$);
    const user = await firstValueFrom(this.auth.user$);
    const requiredLayout = (route.data?.['layout'] as 'superadmin' | 'admin' | 'pos' | 'storefront' | undefined) || undefined;

    if (!isAuthenticated || !user) {
      this.router.navigateByUrl('/auth/login');
      return false;
    }

    const roles: string[] = Array.isArray((user as any)?.roles)
      ? (user as any).roles
      : ((user as any)?.role ? [(user as any).role] : []);

    if (!requiredLayout) {
      // Si no se especifica layout, permitir y confiar en guards existentes
      return true;
    }

    // Usa la misma lógica que el LayoutRouterService para validar
    const allowed = (this as any).getAllowed?.(roles, requiredLayout) ?? this.isLayoutAllowed(roles, requiredLayout);
    if (allowed) {
      return true;
    }

    // No permitido: redirigimos a post-login para recalcular un destino válido
    this.router.navigateByUrl('/post-login');
    return false;
  }

  private isLayoutAllowed(roles: string[], layout: 'superadmin' | 'admin' | 'pos' | 'storefront'): boolean {
    const has = (name: string) => roles.includes(name) || roles.includes(name.toLowerCase()) || roles.includes(name.toUpperCase());

    switch (layout) {
      case 'superadmin':
        return has('super_admin');
      case 'admin':
        return has('super_admin') || has('owner') || has('admin') || has('manager');
      case 'pos':
        return has('super_admin') || has('owner') || has('admin') || has('manager') || has('supervisor') || has('employee');
      case 'storefront':
        return true; // cualquier autenticado puede ver storefront; o restringir a customer si se desea
      default:
        return false;
    }
  }
}
