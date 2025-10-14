import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of, map, take, switchMap } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';
import { AuthContextService } from '../services/auth-context.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

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
          console.log('[AUTH GUARD] User not authenticated, redirecting to login');
          this.router.navigate(['/auth/login']);
          return of(false);
        }

        console.log('[AUTH GUARD] User authenticated, checking context permissions');
        return this.authContext.hasContextPermission().pipe(
          map(hasPermission => {
            if (hasPermission) {
              console.log('[AUTH GUARD] Context permission granted, access allowed');
              return true;
            } else {
              console.log('[AUTH GUARD] Context permission denied, redirecting');
              this.authContext.redirectAuthenticatedUser();
              return false;
            }
          })
        );
      })
    );
  }

  canActivateChild(): Observable<boolean> {
    return this.canActivate();
  }
}