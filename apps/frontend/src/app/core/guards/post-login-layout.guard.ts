import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';

@Injectable({ providedIn: 'root' })
export class PostLoginLayoutGuard implements CanActivate {
  constructor(
    private readonly auth: AuthFacade,
    private readonly authContext: AuthContextService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean> {
    const user = await firstValueFrom(this.auth.user$);

    if (!user) {
      // Si falta info, ir a login o home pública
      this.router.navigateByUrl('/auth/login');
      return false;
    }

    console.log('[POST LOGIN GUARD] Redirecting authenticated user based on context');
    this.authContext.redirectAuthenticatedUser();
    return false;
  }
}
