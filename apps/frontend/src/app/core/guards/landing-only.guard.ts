import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { ConfigFacade } from '../store/config/config.facade';

/**
 * Guard that restricts access to LANDING app types only.
 *
 * Auth routes (/auth/login, /auth/register, etc.) should only be accessible
 * from LANDING contexts (VENDIX_LANDING, ORG_LANDING, STORE_LANDING).
 *
 * EXCEPTION: verify-email route is allowed from ALL app types (ADMIN included)
 * because email verification links can be clicked from any context.
 *
 * For ADMIN and ECOMMERCE app types, users are redirected to '/'.
 */
@Injectable({
  providedIn: 'root',
})
export class LandingOnlyGuard implements CanActivate {
  private configFacade = inject(ConfigFacade);
  private router = inject(Router);

  private readonly ALLOWED_APP_TYPES = [
    'VENDIX_LANDING',
    'ORG_LANDING',
    'STORE_LANDING',
  ];

  // Routes that are allowed from ANY app type (including ADMIN)
  private readonly ALWAYS_ALLOWED_ROUTES = [
    '/auth/verify-email',
  ];

  canActivate(
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> {
    const appConfig = this.configFacade.getCurrentConfig();
    const environment = appConfig?.domainConfig?.environment;

    console.log('🚧 [LANDING-ONLY GUARD] Checking access', {
      path: state.url,
      environment,
      isAllowed: environment ? this.ALLOWED_APP_TYPES.includes(environment) : false,
    });

    // If no config yet, allow access (will be handled by other guards/redirects)
    if (!environment) {
      console.warn('[LANDING-ONLY GUARD] No environment detected, allowing access');
      return of(true);
    }

    // Check if route is in the always-allowed list (e.g., verify-email)
    const isAlwaysAllowed = this.ALWAYS_ALLOWED_ROUTES.some(route =>
      state.url.startsWith(route)
    );
    if (isAlwaysAllowed) {
      console.log('✅ [LANDING-ONLY GUARD] Always-allowed route, granting access');
      return of(true);
    }

    // Check if current app type is a LANDING type
    if (this.ALLOWED_APP_TYPES.includes(environment)) {
      console.log('✅ [LANDING-ONLY GUARD] LANDING app type, allowing access');
      return of(true);
    }

    // Not a LANDING app type - redirect to home
    console.log('🚫 [LANDING-ONLY GUARD] Non-LANDING app type, redirecting to /');
    return of(this.router.createUrlTree(['/']));
  }
}
