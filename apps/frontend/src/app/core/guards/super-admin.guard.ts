import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, take, switchMap } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';

@Injectable({
  providedIn: 'root'
})
export class SuperAdminGuard implements CanActivate {

  constructor(
    private authFacade: AuthFacade,
    private authContext: AuthContextService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> {
    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap(isAuthenticated => {
        if (!isAuthenticated) {
          console.log('[SUPER ADMIN GUARD] User not authenticated, redirecting to login');
          this.router.navigate(['/auth/login']);
          return of(false);
        }

        return this.authContext.getAuthContext().pipe(
          take(1),
          map(context => {
            const userRole = this.authFacade.getCurrentUserRole();
            const userRoles = this.authFacade.getRoles();

            // Allow super admin roles (both backend and frontend naming conventions)
            const superAdminRoles = ['super_admin', 'SUPER_ADMIN'];
            const hasSuperAdminRole = userRole && superAdminRoles.includes(userRole);
            const hasContextAccess = context.contextType === 'vendix' &&
                                   context.allowedRoles.some(role => superAdminRoles.includes(role));

            console.log('[SUPER ADMIN GUARD] Checking access:', {
              userRole,
              userRoles,
              contextType: context.contextType,
              hasSuperAdminRole,
              hasContextAccess
            });

            if (hasSuperAdminRole && hasContextAccess) {
              console.log('[SUPER ADMIN GUARD] Access granted');
              return true;
            }

            // If not authorized, redirect to login
            console.log('[SUPER ADMIN GUARD] Access denied - insufficient permissions or wrong context');
            this.router.navigate(['/auth/login']);
            return false;
          })
        );
      })
    );
  }
}