import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';
import { AppResolverService } from '../services/app-resolver.service';

@Injectable({ providedIn: 'root' })
export class LayoutAccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthFacade,
    private readonly authContext: AuthContextService,
    private readonly appResolver: AppResolverService,
    private readonly router: Router
  ) {}

  async canActivate(route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): Promise<boolean> {
    const isAuthenticated = await firstValueFrom(this.auth.isAuthenticated$);
    const user = await firstValueFrom(this.auth.user$);
    const requiredLayout = (route.data?.['layout'] as string) || undefined;

    if (!isAuthenticated || !user) {
      this.router.navigateByUrl('/auth/login');
      return false;
    }

    if (!requiredLayout) {
      // Si no se especifica layout, permitir y confiar en guards existentes
      return true;
    }

    // Obtener contexto de autenticación
    const authContext = await firstValueFrom(this.authContext.getAuthContext());
    const userRoles = this.auth.getRoles();

    console.log('[LAYOUT ACCESS GUARD] Checking layout access:', {
      requiredLayout,
      userRoles,
      contextType: authContext.contextType,
      allowedRoles: authContext.allowedRoles
    });

    // Verificar si el layout está permitido usando AppResolverService
    const isLayoutAllowed = this.appResolver.isLayoutAllowed(
      requiredLayout,
      authContext.environment,
      userRoles
    );

    if (isLayoutAllowed) {
      console.log('[LAYOUT ACCESS GUARD] Layout access granted');
      return true;
    }

    // No permitido: redirigimos a post-login para recalcular un destino válido
    console.log('[LAYOUT ACCESS GUARD] Layout access denied, redirecting to post-login');
    this.router.navigateByUrl('/post-login');
    return false;
  }
}
