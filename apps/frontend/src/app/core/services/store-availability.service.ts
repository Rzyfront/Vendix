import { Injectable, computed, inject, signal } from '@angular/core';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { AppType } from '../models/domain-config.interface';

/**
 * Public storefront (STORE_ECOMMERCE) availability state.
 *
 * The real, hard block lives in the backend (checkout is rejected with HTTP
 * 403 + `error_code: 'ECOM_CHECKOUT_004'`). This service only reinforces the
 * UX: when the resolved domain config reports
 * `customConfig.ecommerce.general.store_available === false`, a full-screen
 * branded banner is shown. The banner is DISMISSIBLE (the customer can close
 * it to browse the catalog in read-only mode) but REAPPEARS on any customer
 * action — checkout attempt (403 from backend), add-to-cart, or login — by
 * calling `reopen()`.
 *
 * Zoneless-safe: state is exposed as signals/computed (skill:
 * vendix-zoneless-signals). Reads `domainConfig` from `TenantFacade`, which
 * already bridges the NgRx selector to a signal via `toSignal(..., { initialValue })`.
 */
@Injectable({
  providedIn: 'root',
})
export class StoreAvailabilityService {
  private readonly tenantFacade = inject(TenantFacade);

  /** True once the customer dismissed the banner in the current session. */
  readonly dismissed = signal(false);

  /**
   * True when the backend flagged the storefront as unavailable in the
   * resolved domain config. Derived reactively from the tenant `domainConfig`
   * signal so every consumer stays in sync without manual subscriptions.
   */
  readonly unavailable = computed(() => {
    const config = this.tenantFacade.domainConfig();
    // Only the public storefront (STORE_ECOMMERCE) is gated. The root
    // AppComponent is shared across all app types, so we scope strictly by
    // environment to avoid ever overlaying the admin / landing apps.
    if (config?.environment !== AppType.STORE_ECOMMERCE) return false;
    return config?.customConfig?.ecommerce?.general?.store_available === false;
  });

  /** The banner shows only while the store is unavailable AND not dismissed. */
  readonly shouldShowBanner = computed(
    () => this.unavailable() && !this.dismissed(),
  );

  /** Hide the banner so the customer can browse the catalog (read-only). */
  dismiss(): void {
    this.dismissed.set(true);
  }

  /**
   * Re-show the banner. Called at the start of any customer action while the
   * store is unavailable (add-to-cart, login) and by the paywall interceptor
   * when the backend rejects checkout with `ECOM_CHECKOUT_004`.
   */
  reopen(): void {
    this.dismissed.set(false);
  }
}
