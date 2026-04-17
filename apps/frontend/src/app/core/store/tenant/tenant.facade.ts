import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
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

  // ─── Observables (backward compatible) ────────────────────────────────────

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

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────

  readonly domainConfig = toSignal(this.domainConfig$);
  readonly tenantConfig = toSignal(this.tenantConfig$);
  readonly currentEnvironment = toSignal(this.currentEnvironment$);
  readonly tenantLoading = toSignal(this.loading$, { initialValue: false });
  readonly tenantError = toSignal(this.error$);
  readonly initialized = toSignal(this.initialized$, { initialValue: false });
  readonly currentOrganization = toSignal(this.currentOrganization$);
  readonly organizationName = toSignal(this.organizationName$);
  readonly organizationSlug = toSignal(this.organizationSlug$);
  readonly currentStore = toSignal(this.currentStore$);
  readonly storeName = toSignal(this.storeName$);
  readonly storeSlug = toSignal(this.storeSlug$);
  readonly domainHostname = toSignal(this.domainHostname$);
  readonly isVendixDomain = toSignal(this.isVendixDomain$, { initialValue: false });
  readonly tenantInfo = toSignal(this.tenantInfo$);
  readonly organizationInfo = toSignal(this.organizationInfo$);

  // ─── Actions ──────────────────────────────────────────────────────────────

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

  // ─── Synchronous getters — powered by signals (no take(1) antipattern) ────

  getCurrentDomainConfig(): DomainConfig | null {
    return this.domainConfig() ?? null;
  }

  getCurrentTenantConfig(): TenantConfig | null {
    return this.tenantConfig() ?? null;
  }

  getCurrentEnvironment(): AppEnvironment | null {
    return this.currentEnvironment() ?? null;
  }

  getCurrentOrganization(): OrganizationConfig | null {
    return this.currentOrganization() ?? null;
  }

  getCurrentStore(): StoreConfig | null {
    return this.currentStore() ?? null;
  }

  /**
   * Obtiene el ID de la tienda actual de forma robusta.
   * Primero busca en la configuración del tenant, y si no está,
   * busca en la configuración del dominio resuelto (caso e-commerce).
   */
  getCurrentStoreId(): number | null {
    // 1. Intentar obtener desde el store config
    const store = this.currentStore();
    if (store?.id) {
      return parseInt(store.id.toString(), 10);
    }

    // 2. Intentar obtener desde el domain config
    const domain = this.domainConfig();
    if (domain?.store_id) {
      return parseInt(domain.store_id.toString(), 10);
    }

    return null;
  }

  isInitialized(): boolean {
    return this.initialized();
  }

  isLoading(): boolean {
    return this.tenantLoading();
  }
}
