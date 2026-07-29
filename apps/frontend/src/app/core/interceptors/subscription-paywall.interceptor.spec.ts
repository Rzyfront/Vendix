import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { subscriptionPaywallInterceptor } from './subscription-paywall.interceptor';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { StoreAvailabilityService } from '../services/store-availability.service';
import { environment } from '../../../environments/environment';

const TARGET_URL = `${environment.apiUrl}/store/products`;
const DEV_MESSAGE = 'Plan retired — choose an active plan to continue';

describe('subscriptionPaywallInterceptor — SUBSCRIPTION_011 (plan retired)', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let openPaywall: jasmine.Spy;
  let routerStub: { url: string };

  beforeEach(() => {
    openPaywall = jasmine.createSpy('openPaywall');
    routerStub = { url: '/admin/products' };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([subscriptionPaywallInterceptor])),
        provideHttpClientTesting(),
        { provide: SubscriptionAccessService, useValue: { openPaywall } },
        {
          provide: StoreAvailabilityService,
          useValue: { reopen: jasmine.createSpy('reopen') },
        },
        { provide: Router, useValue: routerStub },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Fires a failed write and returns the error the caller received, so we can
   * assert the interceptor still rethrows.
   */
  function failWith(
    code: string,
    status = 402,
    details: Record<string, unknown> = { subscription_state: 'suspended' },
  ): unknown {
    let caught: unknown = null;
    http.post(TARGET_URL, {}).subscribe({
      next: () => undefined,
      error: (err: unknown) => (caught = err),
    });
    httpMock
      .expectOne(TARGET_URL)
      .flush(
        { statusCode: status, error_code: code, message: DEV_MESSAGE, details },
        { status, statusText: 'Payment Required' },
      );
    return caught;
  }

  it('opens the paywall for SUBSCRIPTION_011 (402 blocking, same as 008/009)', () => {
    failWith('SUBSCRIPTION_011');

    expect(openPaywall).toHaveBeenCalledTimes(1);
    expect(openPaywall).toHaveBeenCalledWith('SUBSCRIPTION_011', DEV_MESSAGE, {
      subscription_state: 'suspended',
    });
  });

  it('treats 011 exactly like 008 and 009 — same call shape for all three', () => {
    const calls: unknown[][] = [];
    for (const code of [
      'SUBSCRIPTION_008',
      'SUBSCRIPTION_009',
      'SUBSCRIPTION_011',
    ]) {
      openPaywall.calls.reset();
      failWith(code);
      expect(openPaywall).toHaveBeenCalledTimes(1);
      calls.push(openPaywall.calls.mostRecent().args.slice(1));
    }

    // Message + details are forwarded identically; only the code differs.
    expect(calls[0]).toEqual(calls[2]);
    expect(calls[1]).toEqual(calls[2]);
  });

  it('rethrows the original error so callers can still handle it', () => {
    const caught = failWith('SUBSCRIPTION_011') as { status?: number } | null;

    expect(caught).toBeTruthy();
    expect(caught?.status).toBe(402);
  });

  it('suppresses the duplicate modal when already on the plan catalog', () => {
    routerStub.url = '/admin/subscription/plans';

    failWith('SUBSCRIPTION_011');

    expect(openPaywall).not.toHaveBeenCalled();
  });

  it('suppresses the duplicate modal when already on the plan picker', () => {
    routerStub.url = '/admin/subscription/picker';

    failWith('SUBSCRIPTION_011');

    expect(openPaywall).not.toHaveBeenCalled();
  });

  it('still opens on the dunning board — a retired plan is not a dunning case', () => {
    routerStub.url = '/admin/subscription/dunning';

    failWith('SUBSCRIPTION_011');

    expect(openPaywall).toHaveBeenCalledWith(
      'SUBSCRIPTION_011',
      DEV_MESSAGE,
      jasmine.anything(),
    );
  });
});

describe('subscriptionPaywallInterceptor — 008/009 behavior is unchanged', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let openPaywall: jasmine.Spy;
  let routerStub: { url: string };

  beforeEach(() => {
    openPaywall = jasmine.createSpy('openPaywall');
    routerStub = { url: '/admin/products' };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([subscriptionPaywallInterceptor])),
        provideHttpClientTesting(),
        { provide: SubscriptionAccessService, useValue: { openPaywall } },
        {
          provide: StoreAvailabilityService,
          useValue: { reopen: jasmine.createSpy('reopen') },
        },
        { provide: Router, useValue: routerStub },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function failWith(code: string): void {
    http.post(TARGET_URL, {}).subscribe({
      next: () => undefined,
      error: () => undefined,
    });
    httpMock.expectOne(TARGET_URL).flush(
      {
        statusCode: 402,
        error_code: code,
        message: 'Subscription suspended due to unpaid balance',
        details: { subscription_state: 'suspended' },
      },
      { status: 402, statusText: 'Payment Required' },
    );
  }

  it('opens the paywall for 008 outside the dunning board', () => {
    failWith('SUBSCRIPTION_008');
    expect(openPaywall).toHaveBeenCalledTimes(1);
  });

  it('opens the paywall for 009 outside the dunning board', () => {
    failWith('SUBSCRIPTION_009');
    expect(openPaywall).toHaveBeenCalledTimes(1);
  });

  it('keeps suppressing 008 on the dunning board', () => {
    routerStub.url = '/admin/subscription/dunning';
    failWith('SUBSCRIPTION_008');
    expect(openPaywall).not.toHaveBeenCalled();
  });

  it('keeps suppressing 009 on the dunning board', () => {
    routerStub.url = '/admin/subscription/dunning';
    failWith('SUBSCRIPTION_009');
    expect(openPaywall).not.toHaveBeenCalled();
  });

  it('does not suppress 008 on the plan catalog (its destination is dunning)', () => {
    routerStub.url = '/admin/subscription/plans';
    failWith('SUBSCRIPTION_008');
    expect(openPaywall).toHaveBeenCalledTimes(1);
  });

  it('ignores codes outside the blocking set', () => {
    failWith('ORD_001');
    expect(openPaywall).not.toHaveBeenCalled();
  });
});
