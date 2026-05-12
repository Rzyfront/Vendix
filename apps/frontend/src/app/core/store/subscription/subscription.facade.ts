import { Injectable, inject, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import * as SubscriptionActions from './subscription.actions';
import * as SubscriptionSelectors from './subscription.selectors';
import { SubscriptionState } from './subscription.reducer';
import { DunningState, AppliedCoupon, CouponValidationReason } from './subscription.actions';

/**
 * Discriminated union describing the single, mutually-exclusive subscription
 * UI state. Consumed by banners, pills, top alerts, and sidebar — every
 * surface reads `subscriptionUiState().kind` instead of computing its own
 * combination of flags. Resolution is a strict cascade (first-match-wins) so
 * two surfaces never disagree about what the user should see.
 */
export type SubscriptionUiState =
  | { kind: 'healthy' }
  | { kind: 'pending_initial_payment'; planName: string; invoiceId: number | null }
  | {
      kind: 'pending_change_abandoned';
      fromPlanName: string;
      toPlanName: string;
      invoiceId: number | null;
    }
  | { kind: 'grace_soft'; daysRemaining: number; daysOverdue: number }
  | { kind: 'grace_hard'; daysRemaining: number; daysOverdue: number }
  | { kind: 'expiring_soon'; daysUntilRenewal: number }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'suspended' }
  | { kind: 'blocked' }
  | { kind: 'no_plan' };

const EXPIRING_SOON_THRESHOLD_DAYS = 7;

function daysBetween(future: string | Date | null | undefined): number {
  if (!future) return 0;
  const ts = typeof future === 'string' ? new Date(future).getTime() : future.getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.ceil((ts - Date.now()) / (1000 * 60 * 60 * 24)));
}

function daysSince(past: string | Date | null | undefined): number {
  if (!past) return 0;
  const ts = typeof past === 'string' ? new Date(past).getTime() : past.getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));
}

const DAY_MS = 1000 * 60 * 60 * 24;

function graceDeadline(
  sub: any,
  untilField: string,
  fallbackDaysField: string,
): Date | null {
  if (sub[untilField]) return new Date(sub[untilField]);
  const periodEnd = sub.current_period_end;
  if (!periodEnd) return null;
  const plan: any = sub.paid_plan ?? sub.plan;
  const days = Number(plan?.[fallbackDaysField] ?? 0);
  return new Date(new Date(periodEnd).getTime() + days * DAY_MS);
}

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
   * RNC-PaidPlan — Single source of truth for "what should the UI tell the
   * user about their subscription right now". Cascade order is significant:
   * grace and terminal lifecycle states win over any pending-change concern
   * because they describe a more disruptive condition. See ADR-1 in the
   * implementation plan for the rationale.
   */
  readonly subscriptionUiState = computed<SubscriptionUiState>(() => {
    const sub: any = this.current();
    if (!sub) return { kind: 'healthy' };

    const state = sub.state ?? this.status();

    if (state === 'grace_hard') {
      return {
        kind: 'grace_hard',
        daysRemaining: daysBetween(graceDeadline(sub, 'grace_hard_until', 'grace_period_hard_days')),
        daysOverdue: daysSince(sub.current_period_end),
      };
    }
    if (state === 'grace_soft') {
      return {
        kind: 'grace_soft',
        daysRemaining: daysBetween(graceDeadline(sub, 'grace_soft_until', 'grace_period_soft_days')),
        daysOverdue: daysSince(sub.current_period_end),
      };
    }
    if (state === 'cancelled' || state === 'canceled') {
      return { kind: 'cancelled' };
    }
    if (state === 'expired') {
      return { kind: 'expired' };
    }
    if (state === 'suspended') {
      return { kind: 'suspended' };
    }
    if (state === 'blocked') {
      return { kind: 'blocked' };
    }
    if (state === 'no_plan') {
      return { kind: 'no_plan' };
    }

    const paidPlanId = sub.paid_plan_id ?? null;
    const pendingPlanId = sub.pending_plan_id ?? null;
    const pendingInvoiceId =
      typeof sub.pending_change_invoice_id === 'number'
        ? sub.pending_change_invoice_id
        : null;
    const planName: string =
      sub.paid_plan?.name ?? sub.plan?.name ?? sub.plan_name ?? 'Plan';
    const pendingPlanName: string =
      sub.pending_plan?.name ?? planName;

    if (paidPlanId == null && pendingPlanId != null) {
      return {
        kind: 'pending_initial_payment',
        planName: pendingPlanName,
        invoiceId: pendingInvoiceId,
      };
    }
    if (
      paidPlanId != null &&
      pendingPlanId != null &&
      pendingPlanId !== paidPlanId
    ) {
      return {
        kind: 'pending_change_abandoned',
        fromPlanName: planName,
        toPlanName: pendingPlanName,
        invoiceId: pendingInvoiceId,
      };
    }
    // Recovery-payment-abandoned: user was in grace/suspended, started a
    // checkout for the SAME plan (so paid_plan_id == pending_plan_id), then
    // walked away from the Wompi widget. Without this branch the discriminated
    // union fell to 'healthy' and the UI showed neither the prior dunning
    // banner nor a "complete payment" CTA — the sub was stuck silent.
    // Surfacing it as `pending_initial_payment` reuses the existing
    // "Completa tu pago / Cancelar" banner with no new template work.
    if (state === 'pending_payment' && pendingPlanId != null) {
      return {
        kind: 'pending_initial_payment',
        planName: pendingPlanName,
        invoiceId: pendingInvoiceId,
      };
    }

    if (state === 'active') {
      const daysUntilRenewal = daysBetween(sub.next_billing_at);
      if (daysUntilRenewal > 0 && daysUntilRenewal <= EXPIRING_SOON_THRESHOLD_DAYS) {
        return { kind: 'expiring_soon', daysUntilRenewal };
      }
    }

    return { kind: 'healthy' };
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
