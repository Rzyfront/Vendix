import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import {
  LOCK_REASON_PLAN_RETIRED,
  PaywallVariant,
  SubscriptionAccessService,
} from './subscription-access.service';
import { SubscriptionFacade } from '../store/subscription';

/**
 * Words that would accuse the merchant of a debt. `SUBSCRIPTION_011` means the
 * store's plan was retired from the catalog so the renewal could not run — the
 * store owes nothing. The negative assert is the guard rail that keeps a future
 * refactor from reintroducing dunning language into this variant.
 */
const DEBT_WORDS = ['pago', 'deuda', 'mora', 'pendiente'];

const PLANS_ROUTE = '/admin/subscription/plans';
const DUNNING_ROUTE = '/admin/subscription/dunning';

function variantCopy(variant: PaywallVariant): string {
  return [
    variant.title,
    variant.description,
    variant.ctaLabel,
    variant.badgeLabel ?? '',
    variant.secondaryCtaLabel ?? '',
    ...(variant.benefits ?? []),
  ]
    .join(' | ')
    .toLowerCase();
}

describe('SubscriptionAccessService — SUBSCRIPTION_011 (plan retired)', () => {
  let service: SubscriptionAccessService;
  let navigateByUrl: jasmine.Spy;

  beforeEach(() => {
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        SubscriptionAccessService,
        {
          provide: SubscriptionFacade,
          useValue: {
            featureMatrix: signal<Record<string, { enabled: boolean }>>({}),
            status: signal('suspended'),
          },
        },
        { provide: Router, useValue: { url: '/admin/products', navigateByUrl } },
      ],
    });

    service = TestBed.inject(SubscriptionAccessService);
  });

  it('maps the code to its own variant instead of the generic PLAN_001 fallback', () => {
    service.openPaywall('SUBSCRIPTION_011');

    expect(service.isPaywallOpen()).toBeTrue();
    expect(service.paywallState()?.code).toBe('SUBSCRIPTION_011');
  });

  it('blocks with the same weight as the codes it replaces (008/009)', () => {
    service.openPaywall('SUBSCRIPTION_008');
    const suspended = service.paywallState()?.variant.severity;
    service.closePaywall();

    service.openPaywall('SUBSCRIPTION_009');
    const blocked = service.paywallState()?.variant.severity;
    service.closePaywall();

    service.openPaywall('SUBSCRIPTION_011');
    const retired = service.paywallState()?.variant.severity;

    expect(retired).toBe('critical');
    expect(retired).toBe(suspended);
    expect(retired).toBe(blocked);
  });

  it('is not framed as a payment problem', () => {
    service.openPaywall('SUBSCRIPTION_011');

    expect(service.paywallState()?.variant.category).not.toBe('payment-due');
    expect(service.paywallState()?.variant.category).toBe('upgrade');
  });

  it('never mentions a debt anywhere in the variant copy', () => {
    service.openPaywall('SUBSCRIPTION_011');
    const copy = variantCopy(service.paywallState()!.variant);

    for (const word of DEBT_WORDS) {
      expect(copy).not.toContain(word);
    }
  });

  it('states the truth: plan retired, pick an active plan', () => {
    service.openPaywall('SUBSCRIPTION_011');
    const copy = variantCopy(service.paywallState()!.variant);

    expect(copy).toContain('retirado');
    expect(copy).toContain('catálogo');
    expect(copy).toContain('vigente');
  });

  it('sends the CTA to the plan catalog, never to the dunning board', () => {
    service.openPaywall('SUBSCRIPTION_011');

    expect(service.paywallState()?.variant.ctaRoute).toBe(PLANS_ROUTE);

    service.triggerCta();

    expect(navigateByUrl).toHaveBeenCalledOnceWith(PLANS_ROUTE);
    expect(navigateByUrl).not.toHaveBeenCalledWith(DUNNING_ROUTE);
  });

  it('does not echo the raw machine lock_reason into the user copy', () => {
    service.openPaywall('SUBSCRIPTION_011', undefined, {
      subscription_state: 'suspended',
      lock_reason: LOCK_REASON_PLAN_RETIRED,
    });

    const description = service.paywallState()!.variant.description;
    expect(description).not.toContain(LOCK_REASON_PLAN_RETIRED);
    expect(description).not.toContain('Motivo:');
  });

  it('still appends free-text lock reasons from super-admin locks', () => {
    service.openPaywall('SUBSCRIPTION_009', undefined, {
      subscription_state: 'blocked',
      lock_reason: 'Bloqueo manual por auditoría',
    });

    expect(service.paywallState()!.variant.description).toContain(
      'Motivo: Bloqueo manual por auditoría.',
    );
  });
});

describe('SubscriptionAccessService — state-driven paywall with a retired plan', () => {
  let service: SubscriptionAccessService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SubscriptionAccessService,
        {
          provide: SubscriptionFacade,
          useValue: {
            featureMatrix: signal<Record<string, { enabled: boolean }>>({}),
            status: signal('suspended'),
          },
        },
        {
          provide: Router,
          useValue: {
            url: '/admin/subscription',
            navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true),
          },
        },
      ],
    });

    service = TestBed.inject(SubscriptionAccessService);
  });

  // Same four states the backend `stateToMode()` remaps to 011.
  const OVERRIDDEN_STATES = ['grace_soft', 'grace_hard', 'suspended', 'blocked'];

  for (const state of OVERRIDDEN_STATES) {
    it(`replaces the payment-framed variant for state="${state}"`, () => {
      service.openPaywallForState(state, {
        lock_reason: LOCK_REASON_PLAN_RETIRED,
      });

      expect(service.paywallState()?.code).toBe('SUBSCRIPTION_011');
      const copy = variantCopy(service.paywallState()!.variant);
      for (const word of DEBT_WORDS) {
        expect(copy).not.toContain(word);
      }
    });
  }

  it('keeps the payment-framed variant when there is a real unpaid balance', () => {
    service.openPaywallForState('suspended', { lock_reason: null });

    expect(service.paywallState()?.code).toBe('STATE_SUSPENDED');
    expect(service.paywallState()?.variant.ctaRoute).toBe(DUNNING_ROUTE);
  });

  it('keeps the payment-framed variant when no details are supplied', () => {
    service.openPaywallForState('blocked');

    expect(service.paywallState()?.code).toBe('STATE_BLOCKED');
  });

  it('does not touch terminal states the backend never remaps', () => {
    service.openPaywallForState('cancelled', {
      lock_reason: LOCK_REASON_PLAN_RETIRED,
    });

    expect(service.paywallState()?.code).toBe('STATE_CANCELLED');
  });

  it('ignores an unrelated lock_reason', () => {
    service.openPaywallForState('suspended', {
      lock_reason: 'fraude_reportado',
    });

    expect(service.paywallState()?.code).toBe('STATE_SUSPENDED');
  });
});
