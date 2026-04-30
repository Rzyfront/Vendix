import { Injectable, inject, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import * as SubscriptionActions from './subscription.actions';
import * as SubscriptionSelectors from './subscription.selectors';
import { SubscriptionState } from './subscription.reducer';
import { DunningState, AppliedCoupon, CouponValidationReason } from './subscription.actions';

@Injectable({ providedIn: 'root' })
export class SubscriptionFacade {
  private store = inject(Store<SubscriptionState>);

  readonly current$ = this.store.select(SubscriptionSelectors.selectCurrent);
  readonly status$ = this.store.select(SubscriptionSelectors.selectStatus);
  readonly daysUntilDue$ = this.store.select(
    SubscriptionSelectors.selectDaysUntilDue,
  );
  readonly featureMatrix$ = this.store.select(
    SubscriptionSelectors.selectFeatureMatrix,
  );
  readonly access$ = this.store.select(SubscriptionSelectors.selectAccess);
  readonly loaded$ = this.store.select(SubscriptionSelectors.selectLoaded);
  readonly loading$ = this.store.select(SubscriptionSelectors.selectLoading);
  readonly error$ = this.store.select(SubscriptionSelectors.selectError);
  readonly invoices$ = this.store.select(SubscriptionSelectors.selectInvoices);
  readonly preview$ = this.store.select(SubscriptionSelectors.selectPreview);
  readonly bannerLevel$ = this.store.select(
    SubscriptionSelectors.selectBannerLevel,
  );
  readonly scheduledCancelAt$ = this.store.select(
    SubscriptionSelectors.selectScheduledCancelAt,
  );
  readonly dunning$ = this.store.select(SubscriptionSelectors.selectDunning);
  readonly retryingPayment$ = this.store.select(
    SubscriptionSelectors.selectRetryingPayment,
  );

  // S2.1 — Coupon redemption
  readonly appliedCoupon$ = this.store.select(
    SubscriptionSelectors.selectAppliedCoupon,
  );
  readonly couponValidating$ = this.store.select(
    SubscriptionSelectors.selectCouponValidating,
  );
  readonly couponError$ = this.store.select(
    SubscriptionSelectors.selectCouponError,
  );

  readonly current = toSignal(this.current$, { initialValue: null as any });
  readonly status = toSignal(this.status$, { initialValue: 'none' as string });
  readonly daysUntilDue = toSignal(this.daysUntilDue$, {
    initialValue: 0,
  });
  readonly featureMatrix = toSignal(this.featureMatrix$, {
    initialValue: {} as Record<string, any>,
  });
  readonly access = toSignal(this.access$, { initialValue: null as any });
  readonly loaded = toSignal(this.loaded$, { initialValue: false });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly error = toSignal(this.error$, {
    initialValue: null as string | null,
  });
  readonly invoices = toSignal(this.invoices$, { initialValue: [] as any[] });
  readonly preview = toSignal(this.preview$, { initialValue: null as any });
  readonly bannerLevel = toSignal(this.bannerLevel$, {
    initialValue: 'none' as 'none' | 'info' | 'warning' | 'danger' | 'terminal',
  });
  readonly scheduledCancelAt = toSignal(this.scheduledCancelAt$, {
    initialValue: null as string | null,
  });
  readonly dunning = toSignal(this.dunning$, {
    initialValue: null as DunningState | null,
  });
  readonly retryingPayment = toSignal(this.retryingPayment$, {
    initialValue: false,
  });

  readonly appliedCoupon = toSignal(this.appliedCoupon$, {
    initialValue: null as AppliedCoupon | null,
  });
  readonly couponValidating = toSignal(this.couponValidating$, {
    initialValue: false,
  });
  readonly couponError = toSignal(this.couponError$, {
    initialValue: null as CouponValidationReason | string | null,
  });

  readonly isActive = computed(() => {
    const s = this.status();
    return s === 'active' || s === 'trial' || s === 'trialing';
  });

  readonly isBlocked = computed(() => {
    const s = this.status();
    return (
      s === 'blocked' ||
      s === 'cancelled' ||
      s === 'expired' ||
      s === 'canceled' ||
      s === 'suspended' ||
      s === 'no_plan'
    );
  });

  readonly isTrial = computed(() => {
    const s = this.status();
    return s === 'trial' || s === 'trialing';
  });

  readonly isInGrace = computed(() => {
    const s = this.status();
    return s === 'grace_soft' || s === 'grace_hard';
  });

  /**
   * S1.2 — Notify the subscription feature that the active store context
   * changed. Wipes any data tied to the previous store and (when storeId is
   * not null) chains a fresh `loadCurrent()` via the effect.
   *
   * Pass `null` for ORG_ADMIN / SUPER_ADMIN / logout — banner is hidden in
   * those scopes regardless.
   */
  contextChanged(storeId: number | null): void {
    this.store.dispatch(
      SubscriptionActions.subscriptionContextChanged({ storeId }),
    );
  }

  loadCurrent(): void {
    this.store.dispatch(SubscriptionActions.loadCurrent());
  }

  loadAccess(): void {
    this.store.dispatch(SubscriptionActions.loadAccess());
  }

  subscribe(planId: string, partnerOverrideId?: string): void {
    this.store.dispatch(
      SubscriptionActions.subscribe({ planId, partnerOverrideId }),
    );
  }

  cancel(reason?: string): void {
    this.store.dispatch(SubscriptionActions.cancel({ reason }));
  }

  scheduleCancel(reason?: string): void {
    this.store.dispatch(SubscriptionActions.scheduleCancel({ reason }));
  }

  unscheduleCancel(): void {
    this.store.dispatch(SubscriptionActions.unscheduleCancel());
  }

  changePlan(planId: string): void {
    this.store.dispatch(SubscriptionActions.changePlan({ planId }));
  }

  checkoutPreview(planId: string): void {
    this.store.dispatch(SubscriptionActions.checkoutPreview({ planId }));
  }

  checkoutCommit(planId: string, paymentMethodId?: string): void {
    this.store.dispatch(
      SubscriptionActions.checkoutCommit({ planId, paymentMethodId }),
    );
  }

  loadInvoices(): void {
    this.store.dispatch(SubscriptionActions.loadInvoices());
  }

  loadSubscription(): void {
    this.store.dispatch(SubscriptionActions.loadSubscription());
  }

  loadDunningState(): void {
    this.store.dispatch(SubscriptionActions.loadDunningState());
  }

  retryPayment(): void {
    this.store.dispatch(SubscriptionActions.retryPayment());
  }

  /**
   * Phase 3 — Start polling `/store/subscriptions/current` until the
   * subscription transitions to `active` or `timeoutMs` elapses. Use after
   * the Wompi widget reports APPROVED so the UI catches the asynchronous
   * webhook flip `pending_payment → active`.
   *
   * Pull-fallback: when `invoiceId` is provided, every poll cycle ALSO
   * issues `POST checkout/invoices/:invoiceId/sync-from-gateway` so the
   * backend reconciles directly with Wompi. Required for environments
   * where the Wompi webhook can't reach localhost (dev) or under transient
   * outbound failures (prod). Without invoiceId, polling falls back to the
   * legacy "wait for webhook" behaviour.
   */
  pollSubscriptionUntilActive(opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    invoiceId?: number | null;
  }): void {
    this.store.dispatch(
      SubscriptionActions.pollSubscriptionUntilActive({
        timeoutMs: opts?.timeoutMs,
        intervalMs: opts?.intervalMs,
        invoiceId: opts?.invoiceId ?? null,
      }),
    );
  }

  // S2.1 — Coupon redemption
  validateCoupon(code: string): void {
    this.store.dispatch(SubscriptionActions.validateCoupon({ code }));
  }

  clearCoupon(): void {
    this.store.dispatch(SubscriptionActions.clearCoupon());
  }

  getCurrent(): any {
    return this.current();
  }

  getStatus(): string {
    return this.status();
  }

  isLoaded(): boolean {
    return this.loaded();
  }

  isLoading(): boolean {
    return this.loading();
  }

  getFeatureMatrix(): Record<string, any> {
    return this.featureMatrix();
  }

  canUseFeature(featureKey: string): boolean {
    const matrix = this.featureMatrix();
    const feature = matrix[featureKey];
    if (!feature) return false;
    return feature.enabled === true;
  }

  getDaysUntilDue(): number {
    return this.daysUntilDue();
  }

  getBannerLevel(): 'none' | 'info' | 'warning' | 'danger' | 'terminal' {
    return this.bannerLevel();
  }
}
