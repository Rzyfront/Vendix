import { createSelector, createFeatureSelector } from '@ngrx/store';
import { AuthState } from './auth.reducer';
import {
  FiscalArea,
  FiscalStatusBlock,
  fiscalAreaHasPendingSignal,
  FISCAL_AREAS,
} from '../../models/fiscal-status.model';

export const selectAuthState = createFeatureSelector<AuthState>('auth');

export const selectUser = createSelector(
  selectAuthState,
  (state: AuthState) => state.user,
);

export const selectUserSettings = createSelector(
  selectAuthState,
  (state: AuthState) => state.user_settings,
);

export const selectStoreSettings = createSelector(
  selectAuthState,
  (state: AuthState) => state.store_settings,
);

export const selectOrganizationSettings = createSelector(
  selectUser,
  (user: any) =>
    user?.organizations?.organization_settings?.settings ||
    user?.store?.organizations?.organization_settings?.settings ||
    null,
);

export const selectPermissions = createSelector(
  selectAuthState,
  (state: AuthState) => state.permissions,
);

export const selectRoles = createSelector(
  selectAuthState,
  (state: AuthState) => state.roles,
);

export const selectTokens = createSelector(
  selectAuthState,
  (state: AuthState) => state.tokens,
);

export const selectAccessToken = createSelector(
  selectTokens,
  (tokens: any) => tokens?.access_token || null,
);

export const selectRefreshToken = createSelector(
  selectTokens,
  (tokens: any) => tokens?.refresh_token || null,
);

export const selectIsAuthenticated = createSelector(
  selectUser,
  (user: any) => !!user,
);

export const selectAuthLoading = createSelector(
  selectAuthState,
  (state: AuthState) => state.loading,
);

export const selectAuthError = createSelector(
  selectAuthState,
  (state: AuthState) => state.error,
);

export const selectUserRole = createSelector(selectUser, (user: any) => {
  // Handle both role (string) and roles (array) formats
  if (user?.role) {
    return user.role;
  }
  if (user?.roles && Array.isArray(user.roles) && user.roles.length > 0) {
    // Return the first role or the highest priority role
    return user.roles[0];
  }
  // Handle user_roles structure from backend
  if (
    user?.user_roles &&
    Array.isArray(user.user_roles) &&
    user.user_roles.length > 0
  ) {
    const firstRole = user.user_roles[0]?.roles?.name;
    return firstRole;
  }
  return null;
});

export const selectUserId = createSelector(
  selectUser,
  (user: any) => user?.id || null,
);

export const selectUserEmail = createSelector(
  selectUser,
  (user: any) => user?.email || null,
);

export const selectUserName = createSelector(selectUser, (user: any) =>
  user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : user?.name || null,
);

export const selectIsAdmin = createSelector(
  selectUserRole,
  (role: string) =>
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'SUPER_ADMIN' ||
    role === 'ADMIN',
);

export const selectIsOwner = createSelector(
  selectUserRole,
  (role: string) => role === 'owner' || role === 'OWNER',
);

export const selectIsManager = createSelector(
  selectUserRole,
  (role: string) => role === 'manager' || role === 'MANAGER',
);

export const selectIsEmployee = createSelector(
  selectUserRole,
  (role: string) =>
    role === 'employee' ||
    role === 'cashier' ||
    role === 'EMPLOYEE' ||
    role === 'CASHIER',
);

export const selectIsCustomer = createSelector(
  selectUserRole,
  (role: string) =>
    role === 'customer' ||
    role === 'viewer' ||
    role === 'CUSTOMER' ||
    role === 'VIEWER',
);

export const selectHasPermission = (permission: string) =>
  createSelector(selectPermissions, (permissions: string[]) =>
    permissions.includes(permission),
  );

export const selectHasAnyPermission = (permissions: string[]) =>
  createSelector(selectPermissions, (userPermissions: string[]) =>
    permissions.some((permission) => userPermissions.includes(permission)),
  );

export const selectHasRole = (role: string) =>
  createSelector(selectRoles, (roles: string[]) => roles.includes(role));

export const selectHasAnyRole = (roles: string[]) =>
  createSelector(selectRoles, (userRoles: string[]) =>
    roles.some((role) => userRoles.includes(role)),
  );

export const selectAuthInfo = createSelector(
  selectUser,
  selectIsAuthenticated,
  selectAuthLoading,
  selectPermissions,
  selectRoles,
  (
    user: any,
    isAuthenticated: boolean,
    loading: boolean,
    permissions: string[],
    roles: string[],
  ) => ({
    user,
    isAuthenticated,
    loading,
    permissions,
    roles,
  }),
);

export const selectUserOrganization = createSelector(
  selectUser,
  (user: any) => user?.organizations || null,
);

export const selectUserOrganizationName = createSelector(
  selectUserOrganization,
  (organization: any) => organization?.name || null,
);

export const selectUserOrganizationSlug = createSelector(
  selectUserOrganization,
  (organization: any) => organization?.slug || null,
);

// Organization onboarding selectors
export const selectOrganizationOnboarding = createSelector(
  selectUserOrganization,
  (organization: any) => organization?.onboarding || false,
);

export const selectNeedsOrganizationOnboarding = createSelector(
  selectOrganizationOnboarding,
  (onboarding: boolean) => !onboarding,
);

export const selectUserStore = createSelector(
  selectUser,
  (user: any) => user?.store || user?.stores || null,
);

export const selectUserStoreName = createSelector(
  selectUserStore,
  (store: any) => store?.name || null,
);

export const selectUserStoreSlug = createSelector(
  selectUserStore,
  (store: any) => store?.slug || null,
);

export const selectUserStoreType = createSelector(
  selectUserStore,
  (store: any) => store?.store_type || null,
);

// Onboarding selectors
export const selectOnboardingCompleted = createSelector(
  selectAuthState,
  (state: AuthState) => state.onboarding_completed,
);

export const selectOnboardingCurrentStep = createSelector(
  selectAuthState,
  (state: AuthState) => state.onboarding_current_step,
);

export const selectOnboardingCompletedSteps = createSelector(
  selectAuthState,
  (state: AuthState) => state.onboarding_completed_steps,
);

export const selectNeedsOnboarding = createSelector(
  selectOnboardingCompleted,
  (onboardingCompleted: boolean) => !onboardingCompleted,
);

export const FISCAL_AREA_PANEL_UI_MAP: Record<FiscalArea, string[]> = {
  accounting: [
    'accounting',
    'accounting_journal_entries',
    'accounting_fiscal_periods',
    'accounting_chart_of_accounts',
    'accounting_reports',
    'accounting_account_mappings',
    'accounting_flows_dashboard',
    'cartera_dashboard',
    'cartera_receivables',
    'cartera_payables',
    'cartera_aging',
    'accounting_withholding_tax',
    'accounting_exogenous',
    'taxes_ica',
  ],
  payroll: [
    'payroll',
    'payroll_employees',
    'payroll_runs',
    'payroll_settlements',
    'payroll_advances',
    'payroll_settings',
  ],
  invoicing: [
    'invoicing',
    'invoicing_invoices',
    'invoicing_resolutions',
    'invoicing_dian_config',
  ],
};

function getDisabledKeysByFiscalStatus(
  fiscalStatus: FiscalStatusBlock | null,
): Set<string> {
  const disabled = new Set<string>();
  for (const area of FISCAL_AREAS) {
    const state = fiscalStatus?.[area]?.state;
    if (state !== 'ACTIVE' && state !== 'LOCKED') {
      FISCAL_AREA_PANEL_UI_MAP[area].forEach((key) => disabled.add(key));
    }
  }
  return disabled;
}

export function resolveModuleEnabled(
  settings: any,
  moduleKey: 'accounting' | 'payroll' | 'invoicing',
  organizationSettings?: any,
): boolean {
  const fiscalStatus =
    organizationSettings?.fiscal_status || settings?.fiscal_status || null;
  const state = fiscalStatus?.[moduleKey]?.state;
  return state === 'ACTIVE' || state === 'LOCKED';
}

// Module flows selectors
export const selectModuleFlows = createSelector(
  selectStoreSettings,
  (storeSettings: any) => storeSettings?.module_flows || null,
);

export const selectFiscalStatus = createSelector(
  selectStoreSettings,
  selectOrganizationSettings,
  selectUserOrganization,
  (storeSettings: any, organizationSettings: any, organization: any) => {
    const fiscalScope = organization?.fiscal_scope || organization?.operating_scope;
    if (fiscalScope === 'ORGANIZATION') {
      return (organizationSettings?.fiscal_status || null) as FiscalStatusBlock | null;
    }
    return (storeSettings?.fiscal_status || null) as FiscalStatusBlock | null;
  },
);

export const selectFiscalArea = (area: FiscalArea) =>
  createSelector(selectFiscalStatus, (status) => status?.[area] || null);

export const selectActiveFiscalAreas = createSelector(
  selectFiscalStatus,
  (status) =>
    FISCAL_AREAS.filter((area) => {
      const state = status?.[area]?.state;
      return state === 'ACTIVE' || state === 'LOCKED';
    }),
);

export const selectPendingObligations = createSelector(
  selectFiscalStatus,
  (status) =>
    FISCAL_AREAS.filter((area) =>
      fiscalAreaHasPendingSignal(area, status?.[area]),
    ),
);

export const selectIsModuleFlowEnabled = (module: 'accounting' | 'payroll' | 'invoicing') =>
  createSelector(
    selectStoreSettings,
    selectOrganizationSettings,
    (storeSettings: any, organizationSettings: any) =>
      resolveModuleEnabled(storeSettings, module, organizationSettings),
  );

// Panel UI selectors
export const selectPanelUiConfig = createSelector(
  selectUserSettings,
  (userSettings: any) => userSettings?.config?.panel_ui || {},
);

export const selectSelectedAppType = createSelector(
  selectUserSettings,
  (userSettings: any) => userSettings?.app_type || 'ORG_ADMIN',
);

export const selectCurrentAppPanelUi = createSelector(
  selectPanelUiConfig,
  selectSelectedAppType,
  (panelUi: any, appType: string) => {
    // Support both new format (nested by app type) and old format (direct)
    if (panelUi && panelUi[appType]) {
      return panelUi[appType];
    }
    // Fallback to old format for backward compatibility
    return panelUi || {};
  },
);

export const selectIsModuleVisible = (moduleKey: string) =>
  createSelector(
    selectCurrentAppPanelUi,
    selectStoreSettings,
    selectFiscalStatus,
    (panelUi: any, storeSettings: any, fiscalStatus: FiscalStatusBlock | null) => {
      if (panelUi?.[moduleKey] !== true) return false;
      const disabledKeys = getDisabledKeysByFiscalStatus(fiscalStatus);
      return !disabledKeys.has(moduleKey);
    },
  );

export const selectVisibleModules = createSelector(
  selectCurrentAppPanelUi,
  selectStoreSettings,
  selectFiscalStatus,
  (panelUi: any, storeSettings: any, fiscalStatus: FiscalStatusBlock | null) => {
    if (!panelUi || typeof panelUi !== 'object') return [];
    const disabledKeys = getDisabledKeysByFiscalStatus(fiscalStatus);
    return Object.entries(panelUi)
      .filter(([key, visible]) => visible === true && !disabledKeys.has(key))
      .map(([key]) => key);
  },
);

// Default Panel UI selectors (new module detection)
export const selectDefaultPanelUi = createSelector(
  selectAuthState,
  (state: AuthState) => state.default_panel_ui,
);

export const selectNewModuleKeys = createSelector(
  selectPanelUiConfig,
  selectDefaultPanelUi,
  selectSelectedAppType,
  (panelUi: any, defaults: Record<string, Record<string, boolean>> | null, appType: string) => {
    if (!defaults) return [];
    const userKeys = panelUi?.[appType] || {};
    const defaultKeys = defaults[appType] || {};
    return Object.keys(defaultKeys).filter((key) => !userKeys.hasOwnProperty(key));
  },
);

// Only count new modules for editable app types (ORG_ADMIN, STORE_ADMIN)
// STORE_ECOMMERCE and VENDIX_LANDING are not editable in settings modal
const EDITABLE_APP_TYPES = ['ORG_ADMIN', 'STORE_ADMIN'];

export const selectAllNewModuleCount = createSelector(
  selectPanelUiConfig,
  selectDefaultPanelUi,
  (panelUi: any, defaults: Record<string, Record<string, boolean>> | null) => {
    if (!defaults) return 0;
    let count = 0;
    for (const appType of EDITABLE_APP_TYPES) {
      if (!defaults[appType]) continue;
      const userKeys = panelUi?.[appType] || {};
      const defaultKeys = defaults[appType];
      count += Object.keys(defaultKeys).filter((key) => !userKeys.hasOwnProperty(key)).length;
    }
    return count;
  },
);

export const selectHasNewModules = createSelector(
  selectAllNewModuleCount,
  (count: number) => count > 0,
);

// Domain settings selector
// Prioridad: 1) dominio de la tienda, 2) dominio de la organización
export const selectUserDomainSettings = createSelector(
  selectUser,
  (user: any) => {
    // Primero buscar dominio de la tienda
    if (user?.store?.domain_settings && user.store.domain_settings.length > 0) {
      return user.store.domain_settings[0]; // Tomar el primero (is_primary: true)
    }
    // Si no hay dominio de tienda, buscar dominio de la organización
    if (user?.store?.organizations?.domain_settings && user.store.organizations.domain_settings.length > 0) {
      return user.store.organizations.domain_settings[0]; // Tomar el primero (is_primary: true)
    }
    // También verificar en user.organizations directamente (para login de ORG_ADMIN)
    if (user?.organizations?.domain_settings && user.organizations.domain_settings.length > 0) {
      return user.organizations.domain_settings[0];
    }
    return null;
  },
);

// Domain hostname selector (convenience selector)
export const selectUserDomainHostname = createSelector(
  selectUserDomainSettings,
  (domainSettings: any) => domainSettings?.hostname || null,
);
