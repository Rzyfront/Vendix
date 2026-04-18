import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import * as GlobalSelectors from './global.selectors';

@Injectable({
  providedIn: 'root',
})
export class GlobalFacade {
  private store = inject(Store);

  // Combined state observables
  readonly appState$ = this.store.select(GlobalSelectors.selectAppState);
  readonly userContext$ = this.store.select(GlobalSelectors.selectUserContext);
  readonly appReady$ = this.store.select(GlobalSelectors.selectAppReady);
  readonly brandingContext$ = this.store.select(
    GlobalSelectors.selectBrandingContext,
  );
  readonly permissionContext$ = this.store.select(
    GlobalSelectors.selectPermissionContext,
  );
  readonly navigationContext$ = this.store.select(
    GlobalSelectors.selectNavigationContext,
  );
  readonly globalLoadingState$ = this.store.select(
    GlobalSelectors.selectGlobalLoadingState,
  );
  readonly dataFreshness$ = this.store.select(
    GlobalSelectors.selectDataFreshness,
  );

  // Debug observable (only in development)
  readonly debugInfo$ = this.store.select(GlobalSelectors.selectDebugInfo);

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  readonly appState = toSignal(this.appState$, { initialValue: null as any });
  readonly userContext = toSignal(this.userContext$, { initialValue: null as any });
  readonly appReady = toSignal(this.appReady$, { initialValue: null as any });
  readonly brandingContext = toSignal(this.brandingContext$, { initialValue: null as any });
  readonly permissionContext = toSignal(this.permissionContext$, { initialValue: null as any });
  readonly navigationContext = toSignal(this.navigationContext$, { initialValue: null as any });
  readonly globalLoadingState = toSignal(this.globalLoadingState$, { initialValue: null as any });
  readonly dataFreshness = toSignal(this.dataFreshness$, { initialValue: null as any });
  readonly debugInfo = toSignal(this.debugInfo$, { initialValue: null as any });

  // Synchronous getters for templates
  getUserContext(): any {
    return this.userContext() ?? null;
  }

  getAppReady(): any {
    return this.appReady() ?? null;
  }

  getPermissionContext(): any {
    return this.permissionContext() ?? null;
  }

  getNavigationContext(): any {
    return this.navigationContext() ?? null;
  }

  getBrandingContext(): any {
    return this.brandingContext() ?? null;
  }

  // Utility methods
  isAppReady(): boolean {
    const ready = this.getAppReady();
    return ready?.appReady || false;
  }

  isLoading(): boolean {
    const loading = this.getAppReady();
    return loading?.loading || false;
  }

  hasPermission(permission: string): boolean {
    const permissions = this.getPermissionContext();
    switch (permission) {
      case 'admin':
        return permissions?.canAccessAdmin || false;
      case 'manageUsers':
        return permissions?.canManageUsers || false;
      case 'manageStore':
        return permissions?.canManageStore || false;
      case 'viewReports':
        return permissions?.canViewReports || false;
      case 'processSales':
        return permissions?.canProcessSales || false;
      default:
        return false;
    }
  }

  getAvailableFeatures(): string[] {
    const permissions = this.getPermissionContext();
    return permissions?.availableFeatures || [];
  }

  // Debug method
  getDebugInfo(): any {
    return this.debugInfo() ?? null;
  }
}
