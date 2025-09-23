import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { TenantConfigService } from '../services/tenant-config.service';
import { LayoutRouterService } from '../services/layout-router.service';

@Injectable({ providedIn: 'root' })
export class PostLoginLayoutGuard implements CanActivate {
  constructor(
    private readonly auth: AuthFacade,
    private readonly tenant: TenantConfigService,
    private readonly layoutRouter: LayoutRouterService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean> {
    const user = await firstValueFrom(this.auth.user$);
    const domain = this.tenant.getCurrentDomainConfig();

    if (!user || !domain) {
      // Si falta info, ir a login o home pública
      this.router.navigateByUrl('/auth/login');
      return false;
    }

    // Normalizamos shape esperado por LayoutRouterService
    const roles: string[] = Array.isArray((user as any)?.roles)
      ? (user as any).roles
      : ((user as any)?.role ? [(user as any).role] : []);
    
    // Handle user_roles structure from backend
    if ((user as any)?.user_roles && Array.isArray((user as any).user_roles) && (user as any).user_roles.length > 0) {
      const backendRoles = (user as any).user_roles.map((ur: any) => ur.roles?.name).filter(Boolean);
      roles.push(...backendRoles);
    }
    
    const preferredLayout = (user as any)?.preferredLayout || null;

    const url = this.layoutRouter.computePostLoginUrl(
      { roles, preferredLayout },
      domain.environment,
      { organizationSlug: domain.organizationSlug, storeSlug: domain.storeSlug }
    );

    this.router.navigateByUrl(url);
    return false;
  }
}
