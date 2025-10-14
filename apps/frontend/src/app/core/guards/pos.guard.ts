import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, take, switchMap } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';

@Injectable({
  providedIn: 'root'
})
export class POSGuard implements CanActivate {

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
          console.log('[POS GUARD] User not authenticated, redirecting to login');
          this.router.navigate(['/auth/login']);
          return of(false);
        }

        return this.authContext.getAuthContext().pipe(
          take(1),
          map(context => {
            const userRole = this.authFacade.getCurrentUserRole();
            const userRoles = this.authFacade.getRoles();

            // Allow roles that can access POS: CASHIER, EMPLOYEE, MANAGER, etc.
            const allowedRoles = [
              'CASHIER', 'EMPLOYEE', 'MANAGER', 'SUPERVISOR', 'OWNER', 'ADMIN',
              'supervisor', 'employee', 'manager', 'owner', 'admin'
            ];

            const hasPosRole = userRole && allowedRoles.includes(userRole);
            const hasContextAccess = context.contextType === 'store' &&
                                   context.allowedRoles.some(role => allowedRoles.includes(role));

            console.log('[POS GUARD] Checking access:', {
              userRole,
              userRoles,
              contextType: context.contextType,
              hasPosRole,
              hasContextAccess
            });

            if (hasPosRole && hasContextAccess) {
              console.log('[POS GUARD] Access granted to POS');
              return true;
            }

            // If not authorized, redirect to appropriate dashboard
            console.log('[POS GUARD] Access denied - insufficient permissions or wrong context');
            if (userRoles.some(role => ['admin', 'owner', 'manager'].includes(role))) {
              this.router.navigate(['/admin']);
            } else {
              this.router.navigate(['/auth/login']);
            }
            return false;
          })
        );
      })
    );
  }
}