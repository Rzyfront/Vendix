import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
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

  // Synchronous getters for templates
  getUserContext(): any {
    let result: any = null;
    this.userContext$.subscribe((context) => (result = context)).unsubscribe();
    return result;
  }

  getAppReady(): any {
    let result: any = null;
    this.appReady$.subscribe((ready) => (result = ready)).unsubscribe();
    return result;
  }

  getPermissionContext(): any {
    let result: any = null;
    this.permissionContext$
      .subscribe((context) => (result = context))
      .unsubscribe();
    return result;
  }

  getNavigationContext(): any {
    let result: any = null;
    this.navigationContext$
      .subscribe((context) => (result = context))
      .unsubscribe();
    return result;
  }

  getBrandingContext(): any {
    let result: any = null;
    this.brandingContext$
      .subscribe((context) => (result = context))
      .unsubscribe();
    return result;
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
    let result: any = null;
    this.debugInfo$.subscribe((info) => (result = info)).unsubscribe();
    return result;
  }
}
