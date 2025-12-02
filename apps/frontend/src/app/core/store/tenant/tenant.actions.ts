import { createAction, props } from '@ngrx/store';
import {
  DomainConfig,
  AppEnvironment,
} from '../../models/domain-config.interface';
import { TenantConfig } from '../../models/tenant-config.interface';

export const initTenant = createAction(
  '[Tenant] Init Tenant',
  props<{ domainConfig: DomainConfig }>(),
);

export const initTenantSuccess = createAction(
  '[Tenant] Init Tenant Success',
  props<{ tenantConfig: TenantConfig; domainConfig: DomainConfig }>(),
);

export const initTenantFailure = createAction(
  '[Tenant] Init Tenant Failure',
  props<{ error: any }>(),
);

export const loadTenantConfig = createAction(
  '[Tenant] Load Tenant Config',
  props<{ domainConfig: DomainConfig }>(),
);

export const loadTenantConfigSuccess = createAction(
  '[Tenant] Load Tenant Config Success',
  props<{ tenantConfig: TenantConfig }>(),
);

export const loadTenantConfigFailure = createAction(
  '[Tenant] Load Tenant Config Failure',
  props<{ error: any }>(),
);

export const updateTenantConfig = createAction(
  '[Tenant] Update Tenant Config',
  props<{ config: Partial<TenantConfig> }>(),
);

export const clearTenantConfig = createAction('[Tenant] Clear Tenant Config');

export const setCurrentEnvironment = createAction(
  '[Tenant] Set Current Environment',
  props<{ environment: AppEnvironment }>(),
);

export const setDomainConfig = createAction(
  '[Tenant] Set Domain Config',
  props<{ domainConfig: DomainConfig }>(),
);
