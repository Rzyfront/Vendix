import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TenantState } from './tenant.reducer';
import { DomainConfig, AppEnvironment } from '../../models/domain-config.interface';
import { TenantConfig, OrganizationConfig, StoreConfig } from '../../models/tenant-config.interface';

export const selectTenantState = createFeatureSelector<TenantState>('tenant');

export const selectDomainConfig = createSelector(
  selectTenantState,
  (state: TenantState): DomainConfig | null => state.domainConfig
);

export const selectTenantConfig = createSelector(
  selectTenantState,
  (state: TenantState): TenantConfig | null => state.tenantConfig
);

export const selectCurrentEnvironment = createSelector(
  selectTenantState,
  (state: TenantState): AppEnvironment | null => state.environment
);

export const selectTenantLoading = createSelector(
  selectTenantState,
  (state: TenantState): boolean => state.loading
);

export const selectTenantError = createSelector(
  selectTenantState,
  (state: TenantState): any => state.error
);

export const selectTenantInitialized = createSelector(
  selectTenantState,
  (state: TenantState): boolean => state.initialized
);

// Organization selectors
export const selectCurrentOrganization = createSelector(
  selectTenantConfig,
  (tenantConfig: TenantConfig | null): OrganizationConfig | null =>
    tenantConfig?.organization || null
);

export const selectOrganizationName = createSelector(
  selectCurrentOrganization,
  (organization: OrganizationConfig | null): string =>
    organization?.name || ''
);

export const selectOrganizationSlug = createSelector(
  selectCurrentOrganization,
  (organization: OrganizationConfig | null): string =>
    organization?.slug || ''
);

// Store selectors
export const selectCurrentStore = createSelector(
  selectTenantConfig,
  (tenantConfig: TenantConfig | null): StoreConfig | null =>
    tenantConfig?.store || null
);

export const selectStoreName = createSelector(
  selectCurrentStore,
  (store: StoreConfig | null): string =>
    store?.name || ''
);

export const selectStoreSlug = createSelector(
  selectCurrentStore,
  (store: StoreConfig | null): string =>
    store?.slug || ''
);

// Domain info selectors
export const selectDomainHostname = createSelector(
  selectDomainConfig,
  (domainConfig: DomainConfig | null): string =>
    domainConfig?.hostname || ''
);

export const selectIsVendixDomain = createSelector(
  selectDomainConfig,
  (domainConfig: DomainConfig | null): boolean =>
    domainConfig?.isVendixDomain || false
);

// Feature flags selectors
export const selectFeatureEnabled = (featureName: string) => createSelector(
  selectTenantConfig,
  (tenantConfig: TenantConfig | null): boolean =>
    tenantConfig?.features?.[featureName] || false
);

export const selectAllFeatures = createSelector(
  selectTenantConfig,
  (tenantConfig: TenantConfig | null): Record<string, boolean> =>
    tenantConfig?.features || {}
);

// Combined selectors for common use cases
export const selectTenantInfo = createSelector(
  selectDomainConfig,
  selectTenantConfig,
  selectCurrentEnvironment,
  selectTenantLoading,
  (domainConfig, tenantConfig, environment, loading) => ({
    domainConfig,
    tenantConfig,
    environment,
    loading,
    initialized: !loading && !!domainConfig && !!tenantConfig
  })
);

export const selectOrganizationInfo = createSelector(
  selectCurrentOrganization,
  selectCurrentStore,
  (organization, store) => ({
    organization,
    store,
    hasStore: !!store
  })
);