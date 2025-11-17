import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthService } from '../../services/auth.service';
import { OnboardingWizardService } from '../../services/onboarding-wizard.service';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { extractApiErrorMessage, normalizeApiPayload } from '../../utils/api-error-handler';
import { NavigationService } from '../../services/navigation.service';
import { AppConfigService } from '../../services/app-config.service';
import { ConfigFacade } from '../config';
import { AuthFacade } from './auth.facade';
import * as AuthActions from './auth.actions';
import * as ConfigActions from '../config/config.actions';

@Injectable()
export class AuthEffects {
  private actions$ = inject(Actions);
  private authService = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private navigationService = inject(NavigationService);
  private configFacade = inject(ConfigFacade);
  private authFacade = inject(AuthFacade);
  private appConfigService = inject(AppConfigService);
  private onboardingWizardService = inject(OnboardingWizardService);
  private store = inject(Store);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.login),
      mergeMap(({ email, password, store_slug, organization_slug }) =>
        this.authService.login({ email, password, store_slug, organization_slug }).pipe(
          map(response => {
            if (!response.data) throw new Error('Invalid response data');
            return AuthActions.loginSuccess({
              user: response.data.user,
              user_settings: response.data.user_settings,
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
      tap(async ({ roles, message, updatedEnvironment }) => {
        if (message) this.toast.success(message);
        try {
          const currentConfig = this.configFacade.getCurrentConfig();
          if (!currentConfig || !updatedEnvironment) {
            console.error('[AuthEffects] No config or updated environment for redirection.');
            await this.router.navigateByUrl('/');
            return;
          }

          // 1. Construir la nueva configuración con el entorno del usuario
          const newConfig = this.appConfigService.updateEnvironmentForUser(currentConfig, updatedEnvironment);

          // 2. Despachar la acción para que el store y los demás servicios (RouteManager) se actualicen
          this.store.dispatch(ConfigActions.initializeAppSuccess({ config: newConfig }));

          // 3. Esperar un tick para que el router procese las nuevas rutas
          await new Promise(resolve => setTimeout(resolve, 0));

          // 4. Calcular la ruta de destino usando la NUEVA configuración
          const targetRoute = this.navigationService.redirectAfterLogin(roles || [], newConfig.domainConfig);

          // 5. Navegar
          await this.router.navigateByUrl(targetRoute, { replaceUrl: true });

        } catch (error) {
          console.error('[AuthEffects] Error during post-login redirection:', error);
          await this.router.navigateByUrl('/');
        }
      })
    ),
    { dispatch: false }
  );

  // Check onboarding status after successful login
  checkOnboardingAfterLogin$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loginSuccess),
      mergeMap(({ user }) => {
        // Check if organization has onboarding flag set to true
        const organizationOnboarding = user.organizations?.onboarding;
        const emailVerified = user.email_verified;
        const hasCompleteProfile = user.first_name && user.last_name;
        const hasOrganization = user.organizations && user.organizations.name;

        // Consider onboarding completed if organization.onboarding is true
        const onboardingCompleted = organizationOnboarding && emailVerified && hasCompleteProfile && hasOrganization;

        return of(AuthActions.checkOnboardingStatusSuccess({
          onboardingCompleted,
          currentStep: onboardingCompleted ? 'completed' : 'organization',
          completedSteps: onboardingCompleted ? ['email', 'user', 'organization', 'store', 'app_config'] : []
        }));
      })
    )
  );

  logout$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.logout), mergeMap(() => this.authService.logout().pipe(map(() => AuthActions.logoutSuccess()), catchError(() => of(AuthActions.logoutSuccess()))))));
  logoutSuccess$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.logoutSuccess), tap(() => { if (typeof localStorage !== 'undefined') { localStorage.clear(); } this.router.navigateByUrl('/auth/login'); })), { dispatch: false });
  refreshToken$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.refreshToken), mergeMap(() => this.authService.refreshToken().pipe(map(response => { const accessToken = response.data?.access_token || response.access_token; const refreshToken = response.data?.refresh_token || response.refresh_token; if (!accessToken) throw new Error('Invalid token response'); return AuthActions.refreshTokenSuccess({ tokens: { accessToken, refreshToken: refreshToken || this.authFacade.getTokens()?.refreshToken || '' } }); }), catchError(error => of(AuthActions.refreshTokenFailure({ error: normalizeApiPayload(error) })))))));
  loadUser$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.loadUser), map(() => { const user = this.authFacade.getCurrentUser(); if (user) { return AuthActions.loadUserSuccess({ user }); } else { return AuthActions.loadUserFailure({ error: 'No user found in state' }); } })));
  checkAuthStatus$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.checkAuthStatus), map(() => { try { const authState = localStorage.getItem('vendix_auth_state'); if (authState) { const parsedState = JSON.parse(authState); if (parsedState.user && parsedState.tokens?.accessToken) { return AuthActions.restoreAuthState({ user: parsedState.user, tokens: parsedState.tokens, permissions: parsedState.permissions || [], roles: parsedState.roles || [] }); } } } catch (error) { localStorage.removeItem('vendix_auth_state'); } return AuthActions.clearAuthState(); })));
  forgotOwnerPassword$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.forgotOwnerPassword), mergeMap(({ organization_slug, email }) => this.authService.forgotOwnerPassword(organization_slug, email).pipe(map(() => AuthActions.forgotOwnerPasswordSuccess()), catchError(error => of(AuthActions.forgotOwnerPasswordFailure({ error: normalizeApiPayload(error) })))))));
  resetOwnerPassword$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resetOwnerPassword), mergeMap(({ token, new_password }) => this.authService.resetOwnerPassword(token, new_password).pipe(map(() => AuthActions.resetOwnerPasswordSuccess()), catchError(error => of(AuthActions.resetOwnerPasswordFailure({ error: normalizeApiPayload(error) })))))));
  verifyEmail$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.verifyEmail), mergeMap(({ token }) => this.authService.verifyEmail(token).pipe(map(() => AuthActions.verifyEmailSuccess()), catchError(error => of(AuthActions.verifyEmailFailure({ error: normalizeApiPayload(error) })))))));
  resendVerificationEmail$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resendVerificationEmail), mergeMap(({ email }) => this.authService.resendVerification(email).pipe(map(() => AuthActions.resendVerificationEmailSuccess()), catchError(error => of(AuthActions.resendVerificationEmailFailure({ error: normalizeApiPayload(error) })))))));

  checkOnboardingStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.checkOnboardingStatus),
      mergeMap(() => {
        // Use onboarding wizard service to check status
        return this.onboardingWizardService.getWizardStatus().pipe(
          map(response => {
            if (response.success && response.data) {
              return AuthActions.checkOnboardingStatusSuccess({
                onboardingCompleted: response.data.onboarding_completed,
                currentStep: response.data.current_step,
                completedSteps: response.data.completed_steps || []
              });
            } else {
              return AuthActions.checkOnboardingStatusFailure({ error: 'Invalid response' });
            }
          }),
          catchError(error => of(AuthActions.checkOnboardingStatusFailure({ error: normalizeApiPayload(error) })))
        );
      })
    )
  );
  resetOwnerPasswordSuccess$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.resetOwnerPasswordSuccess), tap(() => { this.toast.success('Contraseña restablecida con éxito.'); this.router.navigateByUrl('/auth/login'); })), { dispatch: false });
  failureToast$ = createEffect(() => this.actions$.pipe(ofType(AuthActions.forgotOwnerPasswordFailure, AuthActions.resetOwnerPasswordFailure, AuthActions.verifyEmailFailure, AuthActions.resendVerificationEmailFailure), tap(({ error }) => { const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error); this.toast.error(errorMessage, 'Error'); })), { dispatch: false });
}
