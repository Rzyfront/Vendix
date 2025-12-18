import { createSelector } from '@ngrx/store';
import { AppEnvironment } from '../models/domain-config.interface';
import * as TenantSelectors from './tenant/tenant.selectors';
import * as AuthSelectors from './auth/auth.selectors';

// Global selectors that combine state from multiple features

// Combined app state selector
export const selectAppState = createSelector(
  TenantSelectors.selectTenantState,
  AuthSelectors.selectAuthState,
  (tenantState, authState) => ({
    tenant: tenantState,
    auth: authState,
  }),
);

// User context selector - combines user info with tenant context
export const selectUserContext = createSelector(
  AuthSelectors.selectUser,
  TenantSelectors.selectCurrentOrganization,
  TenantSelectors.selectCurrentStore,
  TenantSelectors.selectCurrentEnvironment,
  (user, organization, store, environment) => ({
    user,
    organization,
    store,
    environment,
    isAuthenticated: !!user,
    hasOrganization: !!organization,
    hasStore: !!store,
  }),
);

// Application readiness selector
export const selectAppReady = createSelector(
  TenantSelectors.selectTenantInitialized,
  AuthSelectors.selectIsAuthenticated,
  TenantSelectors.selectTenantLoading,
  AuthSelectors.selectAuthLoading,
  (tenantInitialized, isAuthenticated, tenantLoading, authLoading) => ({
    tenantReady: tenantInitialized,
    authReady: !authLoading, // Auth is ready when not loading
    appReady: tenantInitialized && !tenantLoading && !authLoading,
    isAuthenticated,
    loading: tenantLoading || authLoading,
  }),
);

// Branding context selector - combines tenant branding with user preferences
export const selectBrandingContext = createSelector(
  TenantSelectors.selectTenantConfig,
  AuthSelectors.selectUser,
  (tenantConfig, user) => {
    const branding = tenantConfig?.branding;
    return {
      colors: branding?.colors || {},
      theme: tenantConfig?.theme,
      userPreferences: user?.preferences || {},
      logo: branding?.logo,
      customCSS: branding?.customCSS,
    };
  },
);

// Permission context selector - combines user roles with tenant features
export const selectPermissionContext = createSelector(
  AuthSelectors.selectUserRole,
  TenantSelectors.selectAllFeatures,
  AuthSelectors.selectIsAdmin,
  (userRole, features, isAdmin) => ({
    userRole,
    features,
    isAdmin,
    canAccessAdmin: isAdmin || userRole === 'OWNER',
    canManageUsers: isAdmin || userRole === 'OWNER' || userRole === 'MANAGER',
    canManageStore: isAdmin || userRole === 'OWNER' || userRole === 'MANAGER',
    canViewReports:
      isAdmin ||
      userRole === 'OWNER' ||
      userRole === 'MANAGER' ||
      userRole === 'SUPERVISOR',
    canProcessSales: [
      'ADMIN',
      'OWNER',
      'MANAGER',
      'SUPERVISOR',
      'EMPLOYEE',
      'CASHIER',
    ].includes(userRole || ''),
    availableFeatures: Object.keys(features || {}).filter(
      (key) => features?.[key],
    ),
  }),
);

// Navigation context selector - combines routing info with permissions
export const selectNavigationContext = createSelector(
  selectPermissionContext,
  TenantSelectors.selectCurrentEnvironment,
  TenantSelectors.selectIsVendixDomain,
  (permissions, environment, isVendixDomain) => ({
    ...permissions,
    environment,
    isVendixDomain,
    showAdminMenu: permissions.canAccessAdmin,
    showStoreMenu:
      permissions.canManageStore && environment !== AppEnvironment.VENDIX_ADMIN,
    showReportsMenu: permissions.canViewReports,
    showUserManagement: permissions.canManageUsers,
  }),
);

// Loading states selector - combines all loading states
export const selectGlobalLoadingState = createSelector(
  TenantSelectors.selectTenantLoading,
  AuthSelectors.selectAuthLoading,
  TenantSelectors.selectTenantError,
  AuthSelectors.selectAuthError,
  (tenantLoading, authLoading, tenantError, authError) => ({
    loading: tenantLoading || authLoading,
    tenantLoading,
    authLoading,
    hasError: !!tenantError || !!authError,
    errors: {
      tenant: tenantError,
      auth: authError,
    },
  }),
);

// Data freshness selector - tracks when data was last updated
export const selectDataFreshness = createSelector(
  TenantSelectors.selectTenantConfig,
  AuthSelectors.selectUser,
  (tenantConfig, user) => ({
    tenantConfigUpdated: tenantConfig ? new Date().toISOString() : null,
    userUpdated: user ? new Date().toISOString() : null,
    isStale: false, // Could be enhanced with timestamp comparisons
  }),
);

// Debug selector - for development and debugging
export const selectDebugInfo = createSelector(
  selectAppState,
  selectAppReady,
  selectGlobalLoadingState,
  (appState, appReady, loadingState) => ({
    appState,
    appReady,
    loadingState,
    timestamp: new Date().toISOString(),
    environment: {
      isDev: true, // Could be from environment config
      version: '1.0.0', // Could be from build info
    },
  }),
);
