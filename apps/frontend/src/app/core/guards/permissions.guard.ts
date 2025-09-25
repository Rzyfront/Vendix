import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';

@Injectable({
  providedIn: 'root'
})
export class PermissionsGuard implements CanActivate {
  constructor(
    private authFacade: AuthFacade,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    const requiredPermissions = route.data['permissions'] as string[];
    const requiredRoles = route.data['roles'] as string[];

    return this.authFacade.authInfo$.pipe(
      take(1),
      map(authInfo => {
        // Check if user is authenticated
        if (!authInfo.isAuthenticated) {
          this.router.navigate(['/login']);
          return false;
        }

        // Check roles if specified
        if (requiredRoles && requiredRoles.length > 0) {
          const hasRequiredRole = requiredRoles.some(role => authInfo.roles.includes(role));
          if (!hasRequiredRole) {
            console.warn('Access denied: Required roles not met', requiredRoles);
            this.router.navigate(['/unauthorized']);
            return false;
          }
        }

        // Check permissions if specified
        if (requiredPermissions && requiredPermissions.length > 0) {
          const hasRequiredPermission = requiredPermissions.some(permission =>
            authInfo.permissions.includes(permission)
          );
          if (!hasRequiredPermission) {
            console.warn('Access denied: Required permissions not met', requiredPermissions);
            this.router.navigate(['/unauthorized']);
            return false;
          }
        }

        return true;
      })
    );
  }
}