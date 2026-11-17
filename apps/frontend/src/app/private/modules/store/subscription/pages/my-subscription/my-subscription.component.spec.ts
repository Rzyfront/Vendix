import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastService } from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { WompiCheckoutService } from '../../../../../../core/services/wompi-checkout.service';
import { SubscriptionAccessService } from '../../../../../../core/services/subscription-access.service';
import { MySubscriptionComponent } from './my-subscription.component';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * QUI-693 — "Mi Suscripción · ACTIVA" (green) was shown next to "Ciclo vencido"
 * because the badge read only `state`. Both must read `current_period_end`.
 */
describe('MySubscriptionComponent — status badge (QUI-693)', () => {
  const status = signal<string>('active');
  const current = signal<any>(null);
  const uiState = signal<any>({ kind: 'healthy' });

  function setup(opts: {
    state: string;
    periodEndOffsetDays: number;
    uiKind?: string;
    planState?: string;
  }): MySubscriptionComponent {
    status.set(opts.state);
    current.set({
      state: opts.state,
      current_period_end: new Date(Date.now() + opts.periodEndOffsetDays * DAY_MS).toISOString(),
      plan: { name: 'Plan Pro', state: opts.planState ?? 'active', archived_at: null },
    });
    uiState.set({ kind: opts.uiKind ?? 'healthy' });

    TestBed.configureTestingModule({
      imports: [MySubscriptionComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: SubscriptionFacade,
          useValue: {
            current,
            status,
            loading: signal(false),
            featureMatrix: signal(null),
            isActive: computed(() => status() === 'active'),
            isTrial: computed(() => status() === 'trial'),
            subscriptionUiState: uiState,
            loadCurrent: jasmine.createSpy('loadCurrent'),
            loadAccess: jasmine.createSpy('loadAccess'),
          },
        },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
        { provide: StoreSubscriptionService, useValue: {} },
        { provide: WompiCheckoutService, useValue: {} },
        {
          provide: SubscriptionAccessService,
          useValue: jasmine.createSpyObj('SubscriptionAccessService', [
            'openPaywallForState',
            'openPaywallForPaymentSuccess',
            'closePaywall',
            'getAiUsageReport',
          ]),
        },
      ],
    });
    // Only the badge bindings are under test: skip the page markup and its
    // child components.
    TestBed.overrideComponent(MySubscriptionComponent, { set: { template: '', imports: [] } });
    return TestBed.createComponent(MySubscriptionComponent).componentInstance;
  }

  it('active with the cycle already ended reads "Vencida" in yellow, not "Activa" in green', () => {
    const cmp = setup({ state: 'active', periodEndOffsetDays: -3 });

    expect(cmp.cycleIsOverdue()).toBeTrue();
    expect(cmp.badgeLabel()).toBe('Vencida');
    expect(cmp.getStatusLabel()).toBe('Vencida');
    expect(cmp.badgeColor()).toBe('yellow');
  });

  it('active inside its paid cycle keeps "Activa" in green', () => {
    const cmp = setup({ state: 'active', periodEndOffsetDays: 10 });

    expect(cmp.cycleIsOverdue()).toBeFalse();
    expect(cmp.badgeLabel()).toBe('Activa');
    expect(cmp.badgeColor()).toBe('green');
  });

  it('an abandoned plan change does not resurrect "Activa" on an overdue cycle', () => {
    const cmp = setup({
      state: 'active',
      periodEndOffsetDays: -3,
      uiKind: 'pending_change_abandoned',
    });

    expect(cmp.getStatusLabel()).toBe('Vencida');
  });

  it('an abandoned plan change inside the cycle still reads "Activa"', () => {
    const cmp = setup({
      state: 'pending_payment',
      periodEndOffsetDays: 10,
      uiKind: 'pending_change_abandoned',
    });

    expect(cmp.getStatusLabel()).toBe('Activa');
  });

  it('states the engine already escalated keep their own label', () => {
    const cmp = setup({ state: 'grace_soft', periodEndOffsetDays: -7 });

    expect(cmp.badgeLabel()).toBe('En Gracia');
    expect(cmp.badgeColor()).toBe('yellow');
  });

  it('a retired plan still wins the color (red) over the overdue cycle', () => {
    const cmp = setup({ state: 'active', periodEndOffsetDays: -3, planState: 'archived' });

    expect(cmp.badgeColor()).toBe('red');
  });
});
