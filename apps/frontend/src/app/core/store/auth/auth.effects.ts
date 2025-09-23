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
      mergeMap(({ email, password, storeSlug, organizationSlug }) =>
        this.authService.login({ email, password, storeSlug, organizationSlug }).pipe(
          map(response => AuthActions.loginSuccess({
            user: response.data.user,
            tokens: {
              accessToken: response.data.access_token,
              refreshToken: response.data.refresh_token
            }
          })),
          catchError(error => of(AuthActions.loginFailure({ error })))
        )
      )
    )
  );

  loginSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loginSuccess),
      tap(({ user }) => {
        // Store user data if needed
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('vendix_user', JSON.stringify(user));
        }
        // Always redirect to admin dashboard after successful login
        console.log('Login successful, redirecting to admin dashboard...');
        // Add a small delay to ensure the auth state is properly updated
        setTimeout(() => {
          this.router.navigate(['/admin/dashboard']).then(success => {
            if (success) {
              console.log('Successfully navigated to admin dashboard');
            } else {
              console.log('Failed to navigate to admin dashboard');
            }
          });
        }, 200);
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
          map(response => AuthActions.refreshTokenSuccess({
            tokens: {
              accessToken: response.data?.access_token || response.access_token,
              refreshToken: response.data?.refresh_token || response.refresh_token
            }
          })),
          catchError(error => of(AuthActions.refreshTokenFailure({ error })))
        )
      )
    )
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
        if (this.authService.isLoggedIn()) {
          return of(AuthActions.loadUser());
        } else {
          return of(AuthActions.clearAuthState());
        }
      })
    )
  );
}