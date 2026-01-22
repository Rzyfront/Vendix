import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthService } from '../../services/auth.service';
import { OnboardingWizardService } from '../../services/onboarding-wizard.service';
import { ToastService } from '../../../shared/components/toast/toast.service';
import {
  extractApiErrorMessage,
  normalizeApiPayload,
} from '../../utils/api-error-handler';
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
        this.authService
          .login({ email, password, store_slug, organization_slug })
          .pipe(
            map((response) => {
              if (!response.data) throw new Error('Invalid response data');
              return AuthActions.loginSuccess({
                user: response.data.user,
                user_settings: response.data.user_settings,
                tokens: {
                  access_token: response.data.access_token,
                  refresh_token: response.data.refresh_token,
                },
                permissions: response.data.permissions || [],
                roles: response.data.user.roles || [],
                message: response.message,
                updated_environment: response.updatedEnvironment,
              });
            }),
            catchError((error) =>
              of(
                AuthActions.loginFailure({ error: normalizeApiPayload(error) }),
              ),
            ),
          ),
      ),
    ),
  );

  loginCustomer$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loginCustomer),
      mergeMap((loginData) =>
        this.authService.loginCustomer(loginData).pipe(
          map((response) => {
            if (!response.data) throw new Error('Invalid response data');
            return AuthActions.loginCustomerSuccess({
              user: response.data.user,
              user_settings: response.data.user_settings,
              tokens: {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
              },
              permissions: response.data.permissions || [],
              roles: response.data.user.roles || [],
              message: response.message,
              updated_environment: response.updatedEnvironment,
            });
          }),
          catchError((error) =>
            of(
              AuthActions.loginCustomerFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  loginSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.loginSuccess, AuthActions.loginCustomerSuccess),
        tap(async ({ roles, message, updated_environment }) => {
          // CRITICAL: Clear the logout flag on successful login
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('vendix_logged_out_recently');
          }

          if (message) this.toast.success(message);
          try {
            const currentConfig = this.configFacade.getCurrentConfig();
            // Si no hay environment actualizado, asumimos que no hay cambio de entorno
            // Pero para customers, queremos que se queden donde estan si es STORE_ECOMMERCE

            if (!currentConfig || !updated_environment) {
              // Normal flow if no environment update is needed (e.g. standard login)
              // But we should check if we are in ecommerce and user is customer
              return;
            }

            // 1. Construir la nueva configuración con el entorno del usuario
            const newConfig = this.appConfigService.updateEnvironmentForUser(
              currentConfig,
              updated_environment,
            );

            // 2. Despachar la acción para que el store y los demás servicios (RouteManager) se actualicen
            this.store.dispatch(
              ConfigActions.initializeAppSuccess({ config: newConfig }),
            );

            // 3. Esperar para que el router procese las nuevas rutas
            await new Promise((resolve) => setTimeout(resolve, 150));

            // 4. Calcular la ruta de destino usando la NUEVA configuración
            const targetRoute = this.navigationService.redirectAfterLogin(
              roles || [],
              newConfig.domainConfig,
            );

            // 5. Navegar
            await this.router.navigateByUrl(targetRoute, { replaceUrl: true });
          } catch (error) {
            console.error(
              '[AuthEffects] Error during post-login redirection:',
              error,
            );
            await this.router.navigateByUrl('/');
          }
        }),
      ),
    { dispatch: false },
  );

  registerCustomer$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.registerCustomer),
      mergeMap(({ type, ...registerData }) =>
        this.authService.registerCustomer(registerData).pipe(
          map((response) => {
            if (!response.data) throw new Error('Invalid response data');
            return AuthActions.registerCustomerSuccess({
              user: response.data.user,
              user_settings: response.data.user_settings,
              tokens: {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
              },
              permissions: response.data.permissions || [],
              roles: response.data.user.roles || [],
              updated_environment: response.updatedEnvironment,
            });
          }),
          catchError((error) =>
            of(
              AuthActions.registerCustomerFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  registerCustomerSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.registerCustomerSuccess),
        tap(() => {
          this.toast.success('Cuenta creada exitosamente');
        }),
      ),
    { dispatch: false },
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
        const onboardingCompleted =
          organizationOnboarding &&
          emailVerified &&
          hasCompleteProfile &&
          hasOrganization;

        return of(
          AuthActions.checkOnboardingStatusSuccess({
            onboardingCompleted,
            currentStep: onboardingCompleted ? 'completed' : 'organization',
            completedSteps: onboardingCompleted
              ? ['email', 'user', 'organization', 'store', 'app_config']
              : [],
          }),
        );
      }),
    ),
  );

  logout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.logout),
      mergeMap(() =>
        this.authService.logout().pipe(
          map(() => AuthActions.logoutSuccess()),
          catchError(() => of(AuthActions.logoutSuccess())),
        ),
      ),
    ),
  );
  logoutSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.logoutSuccess),
        tap(() => {
          // CRITICAL: Clear store state FIRST before clearing localStorage
          this.store.dispatch(AuthActions.clearAuthState());

          // Limpiar específicamente todas las claves de autenticación
          if (typeof localStorage !== 'undefined') {
            // Eliminar todas las claves de autenticación específicas
            const keysToRemove = [
              'vendix_auth_state',
              'access_token',
              'refresh_token',
              'vendix_user_info',
              'user_settings',
              'permissions',
              'roles',
              'vendix_user_environment',
              'vendix_app_config',
            ];

            keysToRemove.forEach((key) => localStorage.removeItem(key));

            // Establecer bandera temporal para prevenir restauración automática
            localStorage.setItem(
              'vendix_logged_out_recently',
              Date.now().toString(),
            );

            console.log('[LOGOUT] All auth data cleared from localStorage');
          }

          // Navigate AFTER everything is cleared
          this.router.navigateByUrl('/auth/login');
        }),
      ),
    { dispatch: false },
  );
  refreshToken$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.refreshToken),
      mergeMap(() =>
        this.authService.refreshToken().pipe(
          map((response) => {
            const accessToken =
              response.data?.access_token || response.access_token;
            const refreshToken =
              response.data?.refresh_token || response.refresh_token;
            if (!accessToken) throw new Error('Invalid token response');
            return AuthActions.refreshTokenSuccess({
              tokens: {
                access_token: accessToken,
                refresh_token:
                  refreshToken ||
                  this.authFacade.getTokens()?.refresh_token ||
                  '',
              },
            });
          }),
          catchError((error) =>
            of(
              AuthActions.refreshTokenFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  loadUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loadUser),
      map(() => {
        const user = this.authFacade.getCurrentUser();
        if (user) {
          return AuthActions.loadUserSuccess({ user });
        } else {
          return AuthActions.loadUserFailure({
            error: 'No user found in state',
          });
        }
      }),
    ),
  );
  checkAuthStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.checkAuthStatus),
      map(() => {
        try {
          const authState = localStorage.getItem('vendix_auth_state');
          if (authState) {
            const parsedState = JSON.parse(authState);
            if (parsedState.user && parsedState.tokens?.access_token) {
              return AuthActions.restoreAuthState({
                user: parsedState.user,
                user_settings: parsedState.user_settings,
                tokens: parsedState.tokens,
                permissions: parsedState.permissions || [],
                roles: parsedState.roles || [],
              });
            }
          }
        } catch (error) {
          localStorage.removeItem('vendix_auth_state');
        }
        return AuthActions.clearAuthState();
      }),
    ),
  );
  forgotOwnerPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.forgotOwnerPassword),
      mergeMap(({ organization_slug, email }) =>
        this.authService.forgotOwnerPassword(organization_slug, email).pipe(
          map(() => AuthActions.forgotOwnerPasswordSuccess()),
          catchError((error) =>
            of(
              AuthActions.forgotOwnerPasswordFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  resetOwnerPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resetOwnerPassword),
      mergeMap(({ token, new_password }) =>
        this.authService.resetOwnerPassword(token, new_password).pipe(
          map(() => AuthActions.resetOwnerPasswordSuccess()),
          catchError((error) =>
            of(
              AuthActions.resetOwnerPasswordFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  verifyEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.verifyEmail),
      mergeMap(({ token }) =>
        this.authService.verifyEmail(token).pipe(
          map(() => AuthActions.verifyEmailSuccess()),
          catchError((error) =>
            of(
              AuthActions.verifyEmailFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  resendVerificationEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.resendVerificationEmail),
      mergeMap(({ email }) =>
        this.authService.resendVerification(email).pipe(
          map(() => AuthActions.resendVerificationEmailSuccess()),
          catchError((error) =>
            of(
              AuthActions.resendVerificationEmailFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  checkOnboardingStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.checkOnboardingStatus),
      mergeMap(() => {
        // Use onboarding wizard service to check status
        return this.onboardingWizardService.getWizardStatus().pipe(
          map((response) => {
            if (response.success && response.data) {
              return AuthActions.checkOnboardingStatusSuccess({
                onboardingCompleted: response.data.onboarding_completed,
                currentStep: response.data.current_step,
                completedSteps: response.data.completed_steps || [],
              });
            } else {
              return AuthActions.checkOnboardingStatusFailure({
                error: 'Invalid response',
              });
            }
          }),
          catchError((error) =>
            of(
              AuthActions.checkOnboardingStatusFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        );
      }),
    ),
  );
  resetOwnerPasswordSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.resetOwnerPasswordSuccess),
        tap(() => {
          this.toast.success('Contraseña restablecida con éxito.');
          this.router.navigateByUrl('/auth/login');
        }),
      ),
    { dispatch: false },
  );
  failureToast$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          AuthActions.forgotOwnerPasswordFailure,
          AuthActions.resetOwnerPasswordFailure,
          AuthActions.verifyEmailFailure,
          AuthActions.resendVerificationEmailFailure,
        ),
        tap(({ error }) => {
          const errorMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.toast.error(errorMessage, 'Error');
        }),
      ),
    { dispatch: false },
  );

  // Update User Settings
  updateUserSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.updateUserSettings),
      mergeMap(({ user_settings }) =>
        this.authService.updateSettings(user_settings).pipe(
          map((response) => {
            if (response.success && response.data) {
              return AuthActions.updateUserSettingsSuccess({
                user_settings: response.data,
              });
            }
            return AuthActions.updateUserSettingsFailure({
              error: 'Invalid response from server',
            });
          }),
          catchError((error) =>
            of(
              AuthActions.updateUserSettingsFailure({
                error: normalizeApiPayload(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  updateUserSettingsSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.updateUserSettingsSuccess),
        tap(() => {
          this.toast.success('Configuración actualizada correctamente');
        }),
      ),
    { dispatch: false },
  );

  updateUserSettingsFailure$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.updateUserSettingsFailure),
        tap(({ error }) => {
          const errorMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.toast.error(errorMessage, 'Error al actualizar configuración');
        }),
      ),
    { dispatch: false },
  );
}
