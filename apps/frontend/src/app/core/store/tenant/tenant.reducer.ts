import { createReducer, on } from '@ngrx/store';
import { DomainConfig, AppEnvironment } from '../../models/domain-config.interface';
import { TenantConfig } from '../../models/tenant-config.interface';
import * as TenantActions from './tenant.actions';

export interface TenantState {
  domainConfig: DomainConfig | null;
  tenantConfig: TenantConfig | null;
  environment: AppEnvironment | null;
  loading: boolean;
  error: any;
  initialized: boolean;
}

export const initialTenantState: TenantState = {
  domainConfig: null,
  tenantConfig: null,
  environment: null,
  loading: false,
  error: null,
  initialized: false
};

export const tenantReducer = createReducer(
  initialTenantState,

  on(TenantActions.initTenant, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(TenantActions.initTenantSuccess, (state, { tenantConfig, domainConfig }) => ({
    ...state,
    domainConfig,
    tenantConfig,
    environment: domainConfig.environment,
    loading: false,
    initialized: true,
    error: null
  })),

  on(TenantActions.initTenantFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
    initialized: false
  })),

  on(TenantActions.loadTenantConfig, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(TenantActions.loadTenantConfigSuccess, (state, { tenantConfig }) => ({
    ...state,
    tenantConfig,
    loading: false,
    error: null
  })),

  on(TenantActions.loadTenantConfigFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  })),

  on(TenantActions.updateTenantConfig, (state, { config }) => ({
    ...state,
    tenantConfig: state.tenantConfig ? { ...state.tenantConfig, ...config } : null
  })),

  on(TenantActions.clearTenantConfig, (state) => ({
    ...state,
    tenantConfig: null,
    domainConfig: null,
    environment: null,
    initialized: false,
    error: null
  })),

  on(TenantActions.setCurrentEnvironment, (state, { environment }) => ({
    ...state,
    environment
  })),

  on(TenantActions.setDomainConfig, (state, { domainConfig }) => ({
    ...state,
    domainConfig,
    environment: domainConfig.environment,
    initialized: true,
    error: null
  }))
);