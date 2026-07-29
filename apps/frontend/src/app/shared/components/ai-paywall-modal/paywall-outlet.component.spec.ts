import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { PaywallOutletComponent } from './paywall-outlet.component';
import {
  LOCK_REASON_PLAN_RETIRED,
  SubscriptionAccessService,
} from '../../../core/services/subscription-access.service';
import { SubscriptionFacade } from '../../../core/store/subscription';

/** English devMessage the backend returns for SUBSCRIPTION_011. */
const DEV_MESSAGE = 'Plan retired — choose an active plan to continue';
const PLANS_ROUTE = '/admin/subscription/plans';
const DUNNING_ROUTE = '/admin/subscription/dunning';
const DEBT_WORDS = ['pago', 'deuda', 'mora', 'pendiente'];

describe('PaywallOutletComponent — SUBSCRIPTION_011 (plan retired)', () => {
  let fixture: ComponentFixture<PaywallOutletComponent>;
  let component: PaywallOutletComponent;
  let access: SubscriptionAccessService;
  let navigateByUrl: jasmine.Spy;

  beforeEach(() => {
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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

    access = TestBed.inject(SubscriptionAccessService);
    fixture = TestBed.createComponent(PaywallOutletComponent);
    component = fixture.componentInstance;
  });

  function openRetiredPlanPaywall(): void {
    access.openPaywall('SUBSCRIPTION_011', DEV_MESSAGE, {
      subscription_state: 'suspended',
      lock_reason: LOCK_REASON_PLAN_RETIRED,
    });
    fixture.detectChanges();
  }

  it('withholds the English backend devMessage so the Spanish copy wins', () => {
    openRetiredPlanPaywall();

    expect(component.message()).toBeNull();
    expect(component.variantConfig()?.description).toContain('catálogo');
  });

  it('renders the truthful reason in the modal body, not the dev copy', () => {
    openRetiredPlanPaywall();

    const description: HTMLElement | null =
      fixture.nativeElement.querySelector('.paywall-description');

    expect(description).toBeTruthy();
    const text = (description?.textContent ?? '').trim();
    expect(text).toBe(component.variantConfig()!.description);
    expect(text).not.toContain('Plan retired');
    for (const word of DEBT_WORDS) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('renders a CTA that points to the plan catalog', () => {
    openRetiredPlanPaywall();

    const cta: HTMLElement | null =
      fixture.nativeElement.querySelector('.paywall-primary-btn');

    expect(cta).toBeTruthy();
    expect((cta?.textContent ?? '').trim()).toBe('Elegir un plan vigente');
    expect(component.variantConfig()?.ctaRoute).toBe(PLANS_ROUTE);
  });

  it('navigates to the plan catalog even when the modal emits the "pay" action', () => {
    openRetiredPlanPaywall();

    component.onAction('pay');

    expect(navigateByUrl).toHaveBeenCalledOnceWith(PLANS_ROUTE);
    expect(navigateByUrl).not.toHaveBeenCalledWith(DUNNING_ROUTE);
  });

  it('does not offer the dunning support shortcut (there is nothing to collect)', () => {
    openRetiredPlanPaywall();

    expect(component.showSupportShortcut()).toBeFalse();
    expect(component.extraActionLabel()).toBe('');
  });
});

describe('PaywallOutletComponent — 008/009 behavior is unchanged', () => {
  let fixture: ComponentFixture<PaywallOutletComponent>;
  let component: PaywallOutletComponent;
  let access: SubscriptionAccessService;
  let navigateByUrl: jasmine.Spy;

  beforeEach(() => {
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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

    access = TestBed.inject(SubscriptionAccessService);
    fixture = TestBed.createComponent(PaywallOutletComponent);
    component = fixture.componentInstance;
  });

  it('still forwards the backend message as the body override for 008', () => {
    access.openPaywall('SUBSCRIPTION_008', 'Saldo vencido desde el 12 de julio');
    fixture.detectChanges();

    expect(component.message()).toBe('Saldo vencido desde el 12 de julio');
  });

  it('still forwards the backend message as the body override for 009', () => {
    access.openPaywall('SUBSCRIPTION_009', 'Regulariza tu factura');
    fixture.detectChanges();

    expect(component.message()).toBe('Regulariza tu factura');
  });

  it('keeps the support shortcut for 008/009', () => {
    access.openPaywall('SUBSCRIPTION_008');
    fixture.detectChanges();
    expect(component.showSupportShortcut()).toBeTrue();
    expect(component.extraActionLabel()).toBe('Contactar soporte');

    access.closePaywall();
    access.openPaywall('SUBSCRIPTION_009');
    fixture.detectChanges();
    expect(component.showSupportShortcut()).toBeTrue();
  });

  it('keeps sending 008 to the dunning board', () => {
    access.openPaywall('SUBSCRIPTION_008');
    fixture.detectChanges();

    component.onAction('pay');

    expect(navigateByUrl).toHaveBeenCalledOnceWith(DUNNING_ROUTE);
  });
});
