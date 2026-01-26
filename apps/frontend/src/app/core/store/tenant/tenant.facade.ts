import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  DomainConfig,
  AppEnvironment,
} from '../../models/domain-config.interface';
import {
  TenantConfig,
  OrganizationConfig,
  StoreConfig,
} from '../../models/tenant-config.interface';
import * as TenantActions from './tenant.actions';
import * as TenantSelectors from './tenant.selectors';
import { TenantState } from './tenant.reducer';

@Injectable({
  providedIn: 'root',
})
export class TenantFacade {
  private store = inject(Store<TenantState>);

  // State observables
  readonly domainConfig$ = this.store.select(
    TenantSelectors.selectDomainConfig,
  );
  readonly tenantConfig$ = this.store.select(
    TenantSelectors.selectTenantConfig,
  );
  readonly currentEnvironment$ = this.store.select(
    TenantSelectors.selectCurrentEnvironment,
  );
  readonly loading$ = this.store.select(TenantSelectors.selectTenantLoading);
  readonly error$ = this.store.select(TenantSelectors.selectTenantError);
  readonly initialized$ = this.store.select(
    TenantSelectors.selectTenantInitialized,
  );

  // Organization observables
  readonly currentOrganization$ = this.store.select(
    TenantSelectors.selectCurrentOrganization,
  );
  readonly organizationName$ = this.store.select(
    TenantSelectors.selectOrganizationName,
  );
  readonly organizationSlug$ = this.store.select(
    TenantSelectors.selectOrganizationSlug,
  );

  // Store observables
  readonly currentStore$ = this.store.select(
    TenantSelectors.selectCurrentStore,
  );
  readonly storeName$ = this.store.select(TenantSelectors.selectStoreName);
  readonly storeSlug$ = this.store.select(TenantSelectors.selectStoreSlug);

  // Domain observables
  readonly domainHostname$ = this.store.select(
    TenantSelectors.selectDomainHostname,
  );
  readonly isVendixDomain$ = this.store.select(
    TenantSelectors.selectIsVendixDomain,
  );

  // Combined observables
  readonly tenantInfo$ = this.store.select(TenantSelectors.selectTenantInfo);
  readonly organizationInfo$ = this.store.select(
    TenantSelectors.selectOrganizationInfo,
  );

  // Actions
  initTenant(domainConfig: DomainConfig): void {
    this.store.dispatch(TenantActions.initTenant({ domainConfig }));
  }

  loadTenantConfig(domainConfig: DomainConfig): void {
    this.store.dispatch(TenantActions.loadTenantConfig({ domainConfig }));
  }

  updateTenantConfig(config: Partial<TenantConfig>): void {
    this.store.dispatch(TenantActions.updateTenantConfig({ config }));
  }

  clearTenantConfig(): void {
    this.store.dispatch(TenantActions.clearTenantConfig());
  }

  setCurrentEnvironment(environment: AppEnvironment): void {
    this.store.dispatch(TenantActions.setCurrentEnvironment({ environment }));
  }

  setDomainConfig(domainConfig: DomainConfig): void {
    this.store.dispatch(TenantActions.setDomainConfig({ domainConfig }));
  }

  // Feature flag helpers
  isFeatureEnabled(featureName: string): Observable<boolean> {
    return this.store.select(TenantSelectors.selectFeatureEnabled(featureName));
  }

  getAllFeatures(): Observable<Record<string, boolean>> {
    return this.store.select(TenantSelectors.selectAllFeatures);
  }

  // Synchronous getters for templates
  getCurrentDomainConfig(): DomainConfig | null {
    let result: DomainConfig | null = null;
    this.domainConfig$.pipe(take(1)).subscribe((config) => (result = config));
    return result;
  }

  getCurrentTenantConfig(): TenantConfig | null {
    let result: TenantConfig | null = null;
    this.tenantConfig$.pipe(take(1)).subscribe((config) => (result = config));
    return result;
  }

  getCurrentEnvironment(): AppEnvironment | null {
    let result: AppEnvironment | null = null;
    this.currentEnvironment$.pipe(take(1)).subscribe((env) => (result = env));
    return result;
  }

  getCurrentOrganization(): OrganizationConfig | null {
    let result: OrganizationConfig | null = null;
    this.currentOrganization$.pipe(take(1)).subscribe((org) => (result = org));
    return result;
  }

  getCurrentStore(): StoreConfig | null {
    let result: StoreConfig | null = null;
    this.currentStore$.pipe(take(1)).subscribe((store) => (result = store));
    return result;
  }

  /**
   * Obtiene el ID de la tienda actual de forma robusta.
   * Primero busca en la configuración del tenant, y si no está,
   * busca en la configuración del dominio resuelto (caso e-commerce).
   */
  getCurrentStoreId(): number | null {
    // 1. Intentar obtener desde el store config
    const store = this.getCurrentStore();
    if (store?.id) {
      return parseInt(store.id.toString(), 10);
    }

    // 2. Intentar obtener desde el domain config
    const domain = this.getCurrentDomainConfig();
    if (domain?.store_id) {
      return parseInt(domain.store_id.toString(), 10);
    }

    return null;
  }

  isInitialized(): boolean {
    let result = false;
    this.initialized$.pipe(take(1)).subscribe((init) => (result = init));
    return result;
  }

  isLoading(): boolean {
    let result = false;
    this.loading$.pipe(take(1)).subscribe((loading) => (result = loading));
    return result;
  }
}
