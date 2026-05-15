import { Injectable, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import * as AuthActions from './auth.actions';
import * as AuthSelectors from './auth.selectors';
import { AuthState } from './auth.reducer';
import { extractApiErrorMessage } from '../../utils/api-error-handler';
import { SessionService } from '../../services/session.service';
import type {
  OrganizationFiscalScope,
  OrganizationOperatingScope,
} from '../../models/organization.model';
import type { FiscalArea } from '../../models/fiscal-status.model';

@Injectable({
  providedIn: 'root',
})
export class AuthFacade {
  private store = inject(Store<AuthState>);
  private sessionService = inject(SessionService);

  // ─── Observables (backward compatible) ────────────────────────────────────

  readonly user$ = this.store.select(AuthSelectors.selectUser);
  readonly userSettings$ = this.store.select(AuthSelectors.selectUserSettings);
  readonly tokens$ = this.store.select(AuthSelectors.selectTokens);
  readonly isAuthenticated$ = this.store.select(
    AuthSelectors.selectIsAuthenticated,
  );
  readonly loading$ = this.store.select(AuthSelectors.selectAuthLoading);
  readonly error$ = this.store.select(AuthSelectors.selectAuthError);

  // Role-based observables
  readonly userRole$ = this.store.select(AuthSelectors.selectUserRole);
  readonly userRoles$ = this.store.select(AuthSelectors.selectRoles);
  readonly userPermissions$ = this.store.select(
    AuthSelectors.selectPermissions,
  );
  readonly isAdmin$ = this.store.select(AuthSelectors.selectIsAdmin);
  readonly isOwner$ = this.store.select(AuthSelectors.selectIsOwner);
  readonly isManager$ = this.store.select(AuthSelectors.selectIsManager);
  readonly isEmployee$ = this.store.select(AuthSelectors.selectIsEmployee);
  readonly isCustomer$ = this.store.select(AuthSelectors.selectIsCustomer);

  // User info observables
  readonly userId$ = this.store.select(AuthSelectors.selectUserId);
  readonly userEmail$ = this.store.select(AuthSelectors.selectUserEmail);
  readonly userName$ = this.store.select(AuthSelectors.selectUserName);

  // Combined observables
  readonly authInfo$ = this.store.select(AuthSelectors.selectAuthInfo);

  // Onboarding observables
  readonly onboardingCompleted$ = this.store.select(
    AuthSelectors.selectOnboardingCompleted,
  );
  readonly onboardingCurrentStep$ = this.store.select(
    AuthSelectors.selectOnboardingCurrentStep,
  );
  readonly onboardingCompletedSteps$ = this.store.select(
    AuthSelectors.selectOnboardingCompletedSteps,
  );
  readonly needsOnboarding$ = this.store.select(
    AuthSelectors.selectNeedsOnboarding,
  );

  // Organization and Store observables
  readonly userOrganization$ = this.store.select(
    AuthSelectors.selectUserOrganization,
  );
  readonly userOrganizationName$ = this.store.select(
    AuthSelectors.selectUserOrganizationName,
  );
  readonly userOrganizationSlug$ = this.store.select(
    AuthSelectors.selectUserOrganizationSlug,
  );

  // Organization onboarding observables
  readonly organizationOnboarding$ = this.store.select(
    AuthSelectors.selectOrganizationOnboarding,
  );
  readonly needsOrganizationOnboarding$ = this.store.select(
    AuthSelectors.selectNeedsOrganizationOnboarding,
  );

  readonly userStore$ = this.store.select(AuthSelectors.selectUserStore);
  readonly userStoreName$ = this.store.select(
    AuthSelectors.selectUserStoreName,
  );
  readonly userStoreSlug$ = this.store.select(
    AuthSelectors.selectUserStoreSlug,
  );
  readonly userStoreType$ = this.store.select(
    AuthSelectors.selectUserStoreType,
  );

  // Store settings observables
  readonly storeSettings$ = this.store.select(AuthSelectors.selectStoreSettings);
  readonly fiscalStatus$ = this.store.select(AuthSelectors.selectFiscalStatus);
  readonly activeFiscalAreas$ = this.store.select(
    AuthSelectors.selectActiveFiscalAreas,
  );
  readonly pendingFiscalObligations$ = this.store.select(
    AuthSelectors.selectPendingObligations,
  );

  // Panel UI observables
  readonly panelUiConfig$ = this.store.select(
    AuthSelectors.selectPanelUiConfig,
  );
  readonly selectedAppType$ = this.store.select(
    AuthSelectors.selectSelectedAppType,
  );
  readonly currentAppPanelUi$ = this.store.select(
    AuthSelectors.selectCurrentAppPanelUi,
  );
  readonly visibleModules$ = this.store.select(
    AuthSelectors.selectVisibleModules,
  );

  // New module detection observables
  readonly defaultPanelUi$ = this.store.select(
    AuthSelectors.selectDefaultPanelUi,
  );
  readonly hasNewModules$ = this.store.select(AuthSelectors.selectHasNewModules);
  readonly newModuleCount$ = this.store.select(
    AuthSelectors.selectAllNewModuleCount,
  );
  readonly newModuleKeys$ = this.store.select(
    AuthSelectors.selectNewModuleKeys,
  );

  // Domain settings observables
  readonly userDomainSettings$ = this.store.select(
    AuthSelectors.selectUserDomainSettings,
  );
  readonly userDomainHostname$ = this.store.select(
    AuthSelectors.selectUserDomainHostname,
  );

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  // Consumers can migrate from `| async` / `take(1)` to these signals.
  // Naming: same as Observable but without the `$` suffix.

  readonly user = toSignal(this.user$, { initialValue: null as any });
  readonly userSettings = toSignal(this.userSettings$, { initialValue: null as any });
  readonly tokens = toSignal(this.tokens$, { initialValue: null as { access_token: string; refresh_token: string } | null });
  readonly isAuthenticated = toSignal(this.isAuthenticated$, { initialValue: false });
  readonly authLoading = toSignal(this.loading$, { initialValue: false });
  readonly authError = toSignal(this.error$, { initialValue: null });
  readonly userRole = toSignal(this.userRole$, { initialValue: null as string | null });
  readonly userRoles = toSignal(this.userRoles$, { initialValue: [] as string[] });
  readonly userPermissions = toSignal(this.userPermissions$, { initialValue: [] as string[] });
  readonly adminFlag = toSignal(this.isAdmin$, { initialValue: false });
  readonly ownerFlag = toSignal(this.isOwner$, { initialValue: false });
  readonly managerFlag = toSignal(this.isManager$, { initialValue: false });
  readonly employeeFlag = toSignal(this.isEmployee$, { initialValue: false });
  readonly customerFlag = toSignal(this.isCustomer$, { initialValue: false });
  readonly userId = toSignal(this.userId$, { initialValue: null as number | null });
  readonly userEmail = toSignal(this.userEmail$, { initialValue: null as string | null });
  readonly userName = toSignal(this.userName$, { initialValue: null as string | null });
  readonly authInfo = toSignal(this.authInfo$, { initialValue: null as any });
  readonly onboardingCompleted = toSignal(this.onboardingCompleted$, { initialValue: false });
  readonly onboardingCurrentStep = toSignal(this.onboardingCurrentStep$, { initialValue: undefined as string | undefined });
  readonly onboardingCompletedSteps = toSignal(this.onboardingCompletedSteps$, { initialValue: [] as string[] });
  readonly onboardingNeeded = toSignal(this.needsOnboarding$, { initialValue: false });
  readonly userOrganization = toSignal(this.userOrganization$, { initialValue: null as any });
  readonly userOrganizationName = toSignal(this.userOrganizationName$, { initialValue: null as string | null });
  readonly userOrganizationSlug = toSignal(this.userOrganizationSlug$, { initialValue: null as string | null });

  /**
   * Operating scope of the current user's organization.
   * Defaults to 'STORE' when the org payload is missing or has no scope set.
   * Drives org-level UI reactivity (menu filtering, scope-aware components).
   */
  readonly operatingScope = computed<OrganizationOperatingScope>(
    () => (this.userOrganization()?.operating_scope as OrganizationOperatingScope | undefined) ?? 'STORE',
  );
  readonly fiscalScope = computed<OrganizationFiscalScope>(
    () =>
      (this.userOrganization()?.fiscal_scope as
        | OrganizationFiscalScope
        | undefined) ?? this.operatingScope(),
  );
  readonly organizationOnboarding = toSignal(this.organizationOnboarding$, { initialValue: null as any });
  readonly organizationOnboardingNeeded = toSignal(this.needsOrganizationOnboarding$, { initialValue: false });
  readonly userStore = toSignal(this.userStore$, { initialValue: null as any });
  readonly userStoreName = toSignal(this.userStoreName$, { initialValue: null as string | null });
  readonly userStoreSlug = toSignal(this.userStoreSlug$, { initialValue: null as string | null });
  readonly userStoreType = toSignal(this.userStoreType$, { initialValue: null as any });
  readonly storeSettings = toSignal(this.storeSettings$, { initialValue: null as any });
  readonly fiscalStatus = toSignal(this.fiscalStatus$, { initialValue: null as any });
  readonly activeFiscalAreas = toSignal(this.activeFiscalAreas$, { initialValue: [] as FiscalArea[] });
  readonly pendingFiscalObligations = toSignal(this.pendingFiscalObligations$, { initialValue: [] as FiscalArea[] });
  readonly panelUiConfig = toSignal(this.panelUiConfig$, { initialValue: null as any });
  readonly selectedAppType = toSignal(this.selectedAppType$, { initialValue: null as any });
  readonly currentAppPanelUi = toSignal(this.currentAppPanelUi$, { initialValue: null as any });
  readonly visibleModules = toSignal(this.visibleModules$, { initialValue: [] as string[] });
  readonly defaultPanelUi = toSignal(this.defaultPanelUi$, { initialValue: null as any });
  readonly hasNewModules = toSignal(this.hasNewModules$, { initialValue: false });
  readonly newModuleCount = toSignal(this.newModuleCount$, { initialValue: 0 });
  readonly newModuleKeys = toSignal(this.newModuleKeys$, { initialValue: [] as string[] });
  readonly userDomainSettings = toSignal(this.userDomainSettings$, { initialValue: null as any });
  readonly userDomainHostname = toSignal(this.userDomainHostname$, { initialValue: null as string | null });

  // ─── Actions ──────────────────────────────────────────────────────────────

  login(
    email: string,
    password: string,
    store_slug?: string,
    organization_slug?: string,
  ): void {
    this.store.dispatch(
      AuthActions.login({ email, password, store_slug, organization_slug }),
    );
  }

  loginCustomer(email: string, password: string, store_id: number): void {
    this.store.dispatch(
      AuthActions.loginCustomer({ email, password, store_id }),
    );
  }

  registerCustomer(data: {
    email: string;
    password?: string;
    first_name: string;
    last_name: string;
    store_id: number;
    phone?: string;
    document_type?: string;
    document_number?: string;
  }): void {
    this.store.dispatch(AuthActions.registerCustomer(data));
  }

  /**
   * Cierra la sesión del usuario.
   * Usa SessionService para mostrar toast de éxito y coordinar el cierre limpio.
   */
  logout(options?: { redirect?: boolean }): void {
    // Usar SessionService para logout explícito con toast de éxito
    this.sessionService.terminateSession('explicit');
  }

  refreshToken(refresh_token: string): void {
    this.store.dispatch(AuthActions.refreshToken({ refresh_token }));
  }

  loadUser(): void {
    this.store.dispatch(AuthActions.loadUser());
  }

  refreshUser(): void {
    this.store.dispatch(AuthActions.refreshUser());
  }

  checkAuthStatus(): void {
    this.store.dispatch(AuthActions.checkAuthStatus());
  }

  clearAuthState(): void {
    this.store.dispatch(AuthActions.clearAuthState());
  }

  restoreAuthState(
    user: any,
    tokens: { access_token: string; refresh_token: string },
    permissions?: string[],
    roles?: string[],
    user_settings?: any,
    store_settings?: any,
    default_panel_ui?: Record<string, Record<string, boolean>>,
  ): void {
    this.store.dispatch(
      AuthActions.restoreAuthState({
        user,
        user_settings,
        store_settings,
        default_panel_ui,
        tokens,
        permissions,
        roles,
      }),
    );
  }

  forgotOwnerPassword(organization_slug: string, email: string): void {
    this.store.dispatch(
      AuthActions.forgotOwnerPassword({ organization_slug, email }),
    );
  }

  resetOwnerPassword(token: string, new_password: string): void {
    this.store.dispatch(
      AuthActions.resetOwnerPassword({ token, new_password }),
    );
  }

  verifyEmail(token: string): void {
    this.store.dispatch(AuthActions.verifyEmail({ token }));
  }

  resendVerification(email: string): void {
    this.store.dispatch(AuthActions.resendVerificationEmail({ email }));
  }

  // ─── Synchronous getters — powered by signals (no take(1) antipattern) ────

  getCurrentUser(): any {
    return this.user();
  }

  getUserSettings(): any {
    return this.userSettings();
  }

  getCurrentUserRole(): string | null {
    return this.userRole() ?? null;
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated();
  }

  isAdmin(): boolean {
    return this.adminFlag();
  }

  isOwner(): boolean {
    return this.ownerFlag();
  }

  isLoading(): boolean {
    return this.authLoading();
  }

  getError(): string | null {
    const error = this.authError();
    if (error === null || error === undefined) {
      return null;
    } else if (typeof error === 'string') {
      return error;
    } else {
      // Handle NormalizedApiPayload by extracting the message
      return extractApiErrorMessage(error);
    }
  }

  setLoading(loading: boolean): void {
    this.store.dispatch(AuthActions.setLoading({ loading }));
  }

  setAuthError(error: string | null): void {
    this.store.dispatch(AuthActions.setError({ error }));
  }

  getTokens(): { access_token: string; refresh_token: string } | null {
    return this.tokens() ?? null;
  }

  // Permission methods
  hasPermission(permission: string): boolean {
    return this.userPermissions().includes(permission);
  }

  hasAnyPermission(permissions: string[]): boolean {
    const currentPermissions = this.userPermissions();
    return permissions.some((permission) => currentPermissions.includes(permission));
  }

  hasRole(role: string): boolean {
    return this.userRoles().includes(role);
  }

  hasAnyRole(roles: string[]): boolean {
    const currentRoles = this.userRoles();
    return roles.some((role) => currentRoles.includes(role));
  }

  getPermissions(): string[] {
    return this.userPermissions();
  }

  getRoles(): string[] {
    return this.userRoles();
  }

  // Onboarding methods
  checkOnboardingStatus(): void {
    this.store.dispatch(AuthActions.checkOnboardingStatus());
  }

  setOnboardingCompleted(completed: boolean): void {
    this.store.dispatch(AuthActions.setOnboardingCompleted({ completed }));
  }

  // Synchronous onboarding getters
  isOnboardingCompleted(): boolean {
    return this.onboardingCompleted();
  }

  getOnboardingCurrentStep(): string | undefined {
    return this.onboardingCurrentStep();
  }

  getOnboardingCompletedSteps(): string[] {
    return this.onboardingCompletedSteps();
  }

  needsOnboarding(): boolean {
    return this.onboardingNeeded();
  }

  // Panel UI methods
  isModuleVisible(moduleKey: string): boolean {
    return this.visibleModules().includes(moduleKey);
  }

  getVisibleModules$(): Observable<string[]> {
    return this.visibleModules$;
  }

  updateUserSettings(userSettings: any): void {
    this.store.dispatch(
      AuthActions.updateUserSettings({ user_settings: userSettings }),
    );
  }

  // Store settings methods
  updateStoreSettings(storeSettings: any): void {
    this.store.dispatch(
      AuthActions.updateStoreSettings({ store_settings: storeSettings }),
    );
  }

  patchFiscalStatus(fiscalStatus: any): void {
    const user = this.user();
    if (
      this.fiscalScope() === 'ORGANIZATION' &&
      user?.organizations?.organization_settings?.settings
    ) {
      this.store.dispatch(
        AuthActions.updateUser({
          user: {
            ...user,
            organizations: {
              ...user.organizations,
              organization_settings: {
                ...user.organizations.organization_settings,
                settings: {
                  ...user.organizations.organization_settings.settings,
                  fiscal_status: fiscalStatus,
                },
              },
            },
          },
        }),
      );
      return;
    }

    if (
      this.fiscalScope() === 'ORGANIZATION' &&
      user?.store?.organizations?.organization_settings?.settings
    ) {
      this.store.dispatch(
        AuthActions.updateUser({
          user: {
            ...user,
            store: {
              ...user.store,
              organizations: {
                ...user.store.organizations,
                organization_settings: {
                  ...user.store.organizations.organization_settings,
                  settings: {
                    ...user.store.organizations.organization_settings.settings,
                    fiscal_status: fiscalStatus,
                  },
                },
              },
            },
          },
        }),
      );
      return;
    }

    const storeSettings = this.storeSettings();
    if (storeSettings) {
      this.updateStoreSettings({
        ...storeSettings,
        fiscal_status: fiscalStatus,
      });
    }
  }

  getStoreSettings(): any {
    return this.storeSettings();
  }

  setDefaultPanelUi(default_panel_ui: Record<string, Record<string, boolean>>): void {
    this.store.dispatch(AuthActions.setDefaultPanelUi({ default_panel_ui }));
  }

  getUserId(): number | null {
    return this.userId() ?? null;
  }
}
