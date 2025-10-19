import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { extractApiErrorMessage, normalizeApiPayload } from '../../utils/api-error-handler';
import { RouteManagerService } from '../../services/route-manager.service';
import { NavigationService } from '../../services/navigation.service';
import { AppConfigService } from '../../services/app-config.service';
import * as AuthActions from './auth.actions';

@Injectable()
export class AuthEffects {
  private actions$ = inject(Actions);
  private authService = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private routeManager = inject(RouteManagerService);
  private navigationService = inject(NavigationService);
  private appConfig = inject(AppConfigService);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.login),
      mergeMap(({ email, password, store_slug, organization_slug }) =>
        this.authService.login({ email, password, store_slug, organization_slug }).pipe(
          map(response => {
            if (!response.data) {
              throw new Error('Invalid response data');
            }
            // response may include a top-level message
            const apiMessage = response.message;
            return AuthActions.loginSuccess({
              user: response.data.user,
              tokens: {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token
              },
              permissions: response.data.permissions || [],
              roles: response.data.user.roles || [],
              message: apiMessage,
              updatedEnvironment: response.updatedEnvironment
            });
          }),
          catchError(error => of(AuthActions.loginFailure({ error: normalizeApiPayload(error) })))
        )
      )
    )
  );

  loginSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loginSuccess),
      tap(async ({ user, roles, message, updatedEnvironment }) => {
        if (message) {
          this.toast.success(message);
        }
        // Log principal del flujo de loginSuccess
        console.log('[AUTH EFFECTS] loginSuccess$ effect', { user: user?.email, roles });
        try {
          if (updatedEnvironment) {
            await this.appConfig.updateEnvironmentForUser(updatedEnvironment);
          }
          await this.routeManager.configureDynamicRoutes();
          const currentConfig = this.appConfig.getCurrentConfig();
          if (!currentConfig) {
            await this.router.navigateByUrl('/admin', { replaceUrl: true });
            return;
          }
          const domainConfig = currentConfig.domainConfig;
          const tenantContext = currentConfig.tenantConfig;
          const userRoles = roles || [];
          const targetRoute = this.navigationService.redirectAfterLogin(
            userRoles,
            domainConfig,
            tenantContext
          );
          if (this.routeManager.isRouteAvailable(targetRoute)) {
            await this.router.navigateByUrl(targetRoute, { replaceUrl: true });
          } else {
            const fallbackRoute = this.navigationService.getDefaultRouteForEnvironment(domainConfig.environment);
            await this.router.navigateByUrl(fallbackRoute, { replaceUrl: true });
          }
        } catch (error) {
          await this.router.navigateByUrl('/admin', { replaceUrl: true });
        }
      })
    ),
    { dispatch: false }
  );

  logout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logout),
      tap(() => {
        console.warn('[AUTH EFFECTS] logout$');
        this.authService.logout();
      }),
      map(() => AuthActions.logoutSuccess())
    )
  );

  logoutSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logoutSuccess),
      tap(() => {
        console.warn('[AUTH EFFECTS] logoutSuccess$');
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('vendix_user');
          localStorage.removeItem('vendix_current_store');
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
        this.router.navigateByUrl('/auth/login');
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
          catchError(error => of(AuthActions.refreshTokenFailure({ error: normalizeApiPayload(error) })))
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
        try {
          const authState = localStorage.getItem('vendix_auth_state');
          if (authState) {
            const parsedState = JSON.parse(authState);
            if (parsedState.user && parsedState.tokens?.accessToken) {
              console.log('[AUTH EFFECTS] checkAuthStatus$ restoring', parsedState.user.email);
              const permissions = parsedState.permissions || [];
              const roles = parsedState.roles || parsedState.user.roles || [];
              return of(AuthActions.restoreAuthState({
                user: parsedState.user,
                tokens: parsedState.tokens,
                permissions,
                roles
              }));
            }
          }
        } catch (error) {
          // Silenciar otros logs
          localStorage.removeItem('vendix_auth_state');
        }
        return of(AuthActions.clearAuthState());
      })
    )
  );

  // Auto-check auth status on app initialization
  autoCheckAuthStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType('@ngrx/effects/init'),
      map(() => AuthActions.checkAuthStatus())
    )
  );

  restoreAuthState$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.restoreAuthState),
      tap(({ user, tokens }) => {
        console.log('[AUTH EFFECTS] restoreAuthState$', { user: user.email, hasTokens: !!tokens });
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
          catchError(error => of(AuthActions.forgotOwnerPasswordFailure({ error: normalizeApiPayload(error) })))
        )
      )
    )
  );

  resetOwnerPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resetOwnerPassword),
      mergeMap(({ token, new_password }) =>
        this.authService.resetOwnerPassword(token, new_password).pipe(
          map((response: any) => {
            // Check if response indicates success
            if (response.success === true) {
              return AuthActions.resetOwnerPasswordSuccess();
            } else {
              // If success is false, throw the response to be caught by catchError
              throw response;
            }
          }),
          catchError(error => {
            // Serialize error message before dispatching failure action to keep actions serializable
            return of(AuthActions.resetOwnerPasswordFailure({ error: normalizeApiPayload(error) }));
          })
        )
      )
    )
  );

  resetOwnerPasswordSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resetOwnerPasswordSuccess),
      tap(() => {
        this.toast.success('Contraseña restablecida con éxito.');
        this.router.navigateByUrl('/auth/login');
      })
    ),
    { dispatch: false }
  );

  resetOwnerPasswordFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resetOwnerPasswordFailure),
      tap(({ error }) => {
        const errorMessage = typeof error === 'string' 
          ? error 
          : extractApiErrorMessage(error);
        this.toast.error(errorMessage, 'Error al restablecer contraseña');
      })
    ),
    { dispatch: false }
  );

  verifyEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.verifyEmail),
      mergeMap(({ token }) =>
        this.authService.verifyEmail(token).pipe(
          map(() => AuthActions.verifyEmailSuccess()),
          catchError(error => of(AuthActions.verifyEmailFailure({ error: normalizeApiPayload(error) })))
        )
      )
    )
  );

  verifyEmailSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.verifyEmailSuccess),
      tap(() => {
        this.toast.success('Email verificado con éxito.', 'Verificación exitosa');
      })
    ),
    { dispatch: false }
  );

  resendVerificationEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resendVerificationEmail),
      mergeMap(({ email }) =>
        this.authService.resendVerification(email).pipe(
          map(() => AuthActions.resendVerificationEmailSuccess()),
          catchError(error => of(AuthActions.resendVerificationEmailFailure({ error: normalizeApiPayload(error) })))
        )
      )
    )
  );

  resendVerificationEmailSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resendVerificationEmailSuccess),
      tap(() => {
        this.toast.success('Email de verificación reenviado.', 'Email enviado');
      })
    ),
    { dispatch: false }
  );

}