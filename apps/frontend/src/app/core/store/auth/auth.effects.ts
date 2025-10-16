import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import * as AuthActions from './auth.actions';

@Injectable()
export class AuthEffects {
  private actions$ = inject(Actions);
  private authService = inject(AuthService);
  private router = inject(Router);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.login),
      mergeMap(({ email, password, store_slug, organization_slug }) =>
        this.authService.login({ email, password, store_slug, organization_slug }).pipe(
          map(response => {
            if (!response.data) {
              throw new Error('Invalid response data');
            }
            return AuthActions.loginSuccess({
              user: response.data.user,
              tokens: {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token
              },
              permissions: response.data.permissions || [],
              roles: response.data.roles || []
            });
          }),
          catchError(error => of(AuthActions.loginFailure({ error })))
        )
      )
    )
  );

  loginSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loginSuccess),
      tap(({ user, roles }) => {
        console.log('Login successful, determining redirect based on roles:', roles);
        
        // Determine redirect based on user roles (ensure roles is always an array)
        const userRoles = roles || [];
        let redirectPath = this.determineRedirectPath(userRoles, user);
        
        console.log('Redirecting to:', redirectPath);
        this.router.navigate([redirectPath]).then(success => {
          if (success) {
            console.log('Successfully navigated to:', redirectPath);
          } else {
            console.error('Failed to navigate to:', redirectPath);
            // Fallback to admin dashboard
            this.router.navigate(['/admin']);
          }
        });
      })
    ),
    { dispatch: false }
  );

  logout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logout),
      tap(() => {
        this.authService.logout();
      }),
      map(() => AuthActions.logoutSuccess())
    )
  );

  logoutSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logoutSuccess),
      tap(() => {
        // Clear local storage
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('vendix_user');
          localStorage.removeItem('vendix_current_store');
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
        // Navigate to login
        this.router.navigate(['/auth/login']);
      })
    ),
    { dispatch: false }
  );

  refreshToken$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.refreshToken),
      mergeMap(() =>
        this.authService.refreshToken().pipe(
          map(response => {
            const accessToken = response.data?.access_token || response.access_token;
            const refreshToken = response.data?.refresh_token || response.refresh_token;
            if (!accessToken || !refreshToken) {
              throw new Error('Invalid token response');
            }
            return AuthActions.refreshTokenSuccess({
              tokens: {
                accessToken,
                refreshToken
              }
            });
          }),
          catchError(error => of(AuthActions.refreshTokenFailure({ error })))
        )
      )
    )
  );

  refreshTokenSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.refreshTokenSuccess),
      tap(({ tokens }) => {
        // Update localStorage with new tokens
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('access_token', tokens.accessToken);
          localStorage.setItem('refresh_token', tokens.refreshToken);
        }
      })
    ),
    { dispatch: false }
  );

  loadUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loadUser),
      map(() => {
        const user = this.authService.getCurrentUser();
        if (user) {
          return AuthActions.loadUserSuccess({ user });
        } else {
          return AuthActions.loadUserFailure({ error: 'No user found' });
        }
      })
    )
  );

  checkAuthStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.checkAuthStatus),
      mergeMap(() => {
        // Check if we have persisted auth data
        try {
          const authState = localStorage.getItem('vendix_auth_state');
          if (authState) {
            const parsedState = JSON.parse(authState);
            if (parsedState.user && parsedState.tokens?.accessToken) {
              console.log('[AUTH EFFECTS] Restoring auth state from localStorage');
              // Also set tokens in localStorage for interceptor
              localStorage.setItem('access_token', parsedState.tokens.accessToken);
              localStorage.setItem('refresh_token', parsedState.tokens.refreshToken);
              
              return of(AuthActions.restoreAuthState({
                user: parsedState.user,
                tokens: parsedState.tokens
              }));
            }
          }
        } catch (error) {
          console.warn('[AUTH EFFECTS] Error checking persisted auth:', error);
        }
        
        return of(AuthActions.clearAuthState());
      })
    )
  );

  restoreAuthState$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.restoreAuthState),
      tap(({ user, tokens }) => {
        console.log('[AUTH EFFECTS] Auth state restored successfully', { user: user.email, hasTokens: !!tokens });
      })
    ),
    { dispatch: false }
  );

  forgotOwnerPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.forgotOwnerPassword),
      mergeMap(({ organization_slug, email }) =>
        this.authService.forgotOwnerPassword(organization_slug, email).pipe(
          map(() => AuthActions.forgotOwnerPasswordSuccess()),
          catchError(error => of(AuthActions.forgotOwnerPasswordFailure({ error })))
        )
      )
    )
  );

  resetOwnerPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resetOwnerPassword),
      mergeMap(({ token, new_password }) =>
        this.authService.resetOwnerPassword(token, new_password).pipe(
          map(() => AuthActions.resetOwnerPasswordSuccess()),
          catchError(error => {
            // Extract specific error message from API response
            let errorMessage = 'Error al restablecer la contraseña. Por favor, inténtalo de nuevo.';
            
            if (error.error?.message?.message) {
              errorMessage = error.error.message.message;
            } else if (error.error?.message) {
              errorMessage = error.error.message;
            } else if (error.message) {
              errorMessage = error.message;
            }
            
            return of(AuthActions.resetOwnerPasswordFailure({ error: errorMessage }));
          })
        )
      )
    )
  );

  // Helper method to determine redirect path based on user roles
  private determineRedirectPath(roles: string[], user: any): string {
    console.log('Determining redirect path for roles:', roles, 'user:', user);
    
    // Priority-based role redirection
    if (roles.includes('super_admin')) {
      return '/superadmin';
    } else if (roles.includes('owner') || roles.includes('admin')) {
      return '/admin';
    } else if (roles.includes('manager')) {
      return '/admin/store';
    } else if (roles.includes('supervisor') || roles.includes('employee')) {
      // Since POS route doesn't exist yet, redirect to store ecommerce for now
      return '/store-ecommerce';
    } else if (roles.includes('customer')) {
      return '/shop';
    }
    
    // Default fallback
    console.warn('No specific role match found, defaulting to admin dashboard');
    return '/admin';
  }
}