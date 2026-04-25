import { Injectable, inject, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import * as SubscriptionActions from './subscription.actions';
import * as SubscriptionSelectors from './subscription.selectors';
import { SubscriptionState } from './subscription.reducer';

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
    initialValue: 'none' as 'none' | 'info' | 'warning' | 'danger',
  });

  readonly isActive = computed(() => {
    const s = this.status();
    return s === 'active' || s === 'trialing';
  });

  readonly isBlocked = computed(() => {
    const s = this.status();
    return (
      s === 'blocked' || s === 'cancelled' || s === 'expired' || s === 'canceled'
    );
  });

  readonly isTrial = computed(() => this.status() === 'trialing');

  readonly isInGrace = computed(() => {
    const s = this.status();
    return s === 'grace_soft' || s === 'grace_hard';
  });

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

  getBannerLevel(): 'none' | 'info' | 'warning' | 'danger' {
    return this.bannerLevel();
  }
}
