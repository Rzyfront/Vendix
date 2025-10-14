import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { map, take, filter, switchMap } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(
    private authFacade: AuthFacade,
    private authContext: AuthContextService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> {
    // Wait for both authentication and user data to be loaded
    return combineLatest([
      this.authFacade.user$,
      this.authFacade.userRole$
    ]).pipe(
      filter(([user, role]) => user !== null), // Wait until user data is loaded
      take(1),
      switchMap(([user, userRole]) =>
        this.authContext.hasContextPermission().pipe(
          map(hasPermission => {
            console.log('Admin guard checking user:', user);
            console.log('Admin guard checking role from selector:', userRole);
            console.log('Admin guard checking context permission:', hasPermission);
            
            const isAuthenticated = this.authFacade.isLoggedIn();
            if (!isAuthenticated) {
              console.log('User not authenticated, redirecting to login');
              this.router.navigate(['/auth/login']);
              return false;
            }
            
            // Allow admin roles: including both frontend and backend role names
            const adminRoles = [
              // Backend role names
              'super_admin', 'admin', 'owner', 'manager', 'supervisor',
              // Frontend role names (for compatibility)
              'SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'
            ];

            const hasAdminRole = userRole && adminRoles.includes(userRole);
            const hasContextAccess = hasPermission;

            if (hasAdminRole && hasContextAccess) {
              console.log(`User with role ${userRole} granted access to admin area`);
              return true;
            }

            // If not authorized, redirect to login
            console.log(`User with role ${userRole} denied access to admin area. Context access: ${hasContextAccess}`);
            this.router.navigate(['/auth/login']);
            return false;
          })
        )
      )
    );
  }
}
