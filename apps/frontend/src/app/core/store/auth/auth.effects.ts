import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { extractApiErrorMessage, normalizeApiPayload } from '../../utils/api-error-handler';
import { NavigationService } from '../../services/navigation.service';
import { ConfigFacade } from '../config';
import { AuthFacade } from './auth.facade';
import * as AuthActions from './auth.actions';

@Injectable()
export class AuthEffects {
  private actions$ = inject(Actions);
  private authService = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private navigationService = inject(NavigationService);
  private configFacade = inject(ConfigFacade);
  private authFacade = inject(AuthFacade);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.login),
      mergeMap(({ email, password, store_slug, organization_slug }) =>
        this.authService.login({ email, password, store_slug, organization_slug }).pipe(
          map(response => {
            if (!response.data) throw new Error('Invalid response data');
            return AuthActions.loginSuccess({
              user: response.data.user,
              tokens: { accessToken: response.data.access_token, refreshToken: response.data.refresh_token },
              permissions: response.data.permissions || [],
              roles: response.data.user.roles || [],
              message: response.message,
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
      tap(async ({ roles, message }) => {
        if (message) this.toast.success(message);
        try {
          const currentConfig = this.configFacade.getCurrentConfig(); // <-- CORREGIDO
          if (!currentConfig) {
            console.error('[AuthEffects] No config for redirection.');
            await this.router.navigateByUrl('/');
            return;
          }
          const targetRoute = this.navigationService.redirectAfterLogin(roles || [], currentConfig.domainConfig);
          await this.router.navigateByUrl(targetRoute, { replaceUrl: true });
        } catch (error) {
          console.error('[AuthEffects] Error during post-login redirection:', error);
          await this.router.navigateByUrl('/');
        }
      })
    ),
    { dispatch: false }
  );

  logout$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.logout), mergeMap(() => this.authService.logout().pipe(map(() => AuthActions.logoutSuccess()), catchError(() => of(AuthActions.logoutSuccess()))))));

  logoutSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logoutSuccess),
      tap(() => {
        if (typeof localStorage !== 'undefined') {
          localStorage.clear();
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
            if (!accessToken) throw new Error('Invalid token response');
            return AuthActions.refreshTokenSuccess({ tokens: { accessToken, refreshToken: refreshToken || this.authFacade.getTokens()?.refreshToken || '' } });
          }),
          catchError(error => of(AuthActions.refreshTokenFailure({ error: normalizeApiPayload(error) })))
        )
      )
    )
  );

  loadUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loadUser),
      map(() => {
        const user = this.authFacade.getCurrentUser(); // <-- CORREGIDO
        if (user) {
          return AuthActions.loadUserSuccess({ user });
        } else {
          return AuthActions.loadUserFailure({ error: 'No user found in state' });
        }
      })
    )
  );

  checkAuthStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.checkAuthStatus),
      map(() => {
        try {
          const authState = localStorage.getItem('vendix_auth_state');
          if (authState) {
            const parsedState = JSON.parse(authState);
            if (parsedState.user && parsedState.tokens?.accessToken) {
              return AuthActions.restoreAuthState({ user: parsedState.user, tokens: parsedState.tokens, permissions: parsedState.permissions || [], roles: parsedState.roles || [] });
            }
          }
        } catch (error) { localStorage.removeItem('vendix_auth_state'); }
        return AuthActions.clearAuthState();
      })
    )
  );

  forgotOwnerPassword$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.forgotOwnerPassword), mergeMap(({ organization_slug, email }) => this.authService.forgotOwnerPassword(organization_slug, email).pipe(map(() => AuthActions.forgotOwnerPasswordSuccess()), catchError(error => of(AuthActions.forgotOwnerPasswordFailure({ error: normalizeApiPayload(error) })))))));
  resetOwnerPassword$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resetOwnerPassword), mergeMap(({ token, new_password }) => this.authService.resetOwnerPassword(token, new_password).pipe(map(() => AuthActions.resetOwnerPasswordSuccess()), catchError(error => of(AuthActions.resetOwnerPasswordFailure({ error: normalizeApiPayload(error) })))))));
  verifyEmail$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.verifyEmail), mergeMap(({ token }) => this.authService.verifyEmail(token).pipe(map(() => AuthActions.verifyEmailSuccess()), catchError(error => of(AuthActions.verifyEmailFailure({ error: normalizeApiPayload(error) })))))));
  resendVerificationEmail$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resendVerificationEmail), mergeMap(({ email }) => this.authService.resendVerification(email).pipe(map(() => AuthActions.resendVerificationEmailSuccess()), catchError(error => of(AuthActions.resendVerificationEmailFailure({ error: normalizeApiPayload(error) })))))));

  // Effects con Toasts
  resetOwnerPasswordSuccess$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resetOwnerPasswordSuccess), tap(() => { this.toast.success('Contraseña restablecida con éxito.'); this.router.navigateByUrl('/auth/login'); })), { dispatch: false });
  failureToast$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.loginFailure, AuthActions.forgotOwnerPasswordFailure, AuthActions.resetOwnerPasswordFailure, AuthActions.verifyEmailFailure, AuthActions.resendVerificationEmailFailure), tap(({ error }) => { const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error); this.toast.error(errorMessage, 'Error'); })), { dispatch: false });
}