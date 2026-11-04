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
import { PlanPaywallService } from '../services/plan-paywall.service';
import { environment } from '../../../environments/environment';

/**
 * «Venta blindada» (PR #1080): with the plan gate in `enforce` the backend
 * answers `403 PLAN_MODULE_NOT_INCLUDED`; during a sale the module paywall must
 * never open over the cart or the payment. The error is still re-thrown.
 */
describe('subscriptionPaywallInterceptor — plan paywall never opens during a sale', () => {
  const PREVIEW_URL = `${environment.apiUrl}/store/withholding-tax/preview`;
  const NEW_GATED_URL = `${environment.apiUrl}/store/invoicing/some-new-sale-call`;
  const DETAILS = {
    module: 'accounting_withholding_tax',
    current_plan: { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'monthly' },
    required_plans: [],
    upgrade_url: '/admin/subscription/plans?from=accounting_withholding_tax',
  };

  let httpMock: HttpTestingController;
  let http: HttpClient;
  let showFromApi: jasmine.Spy;
  let openPaywall: jasmine.Spy;
  let warn: jasmine.Spy;
  let routerStub: { url: string };

  beforeEach(() => {
    showFromApi = jasmine.createSpy('showFromApi').and.returnValue(true);
    openPaywall = jasmine.createSpy('openPaywall');
    warn = spyOn(console, 'warn');
    routerStub = { url: '/admin/pos' };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([subscriptionPaywallInterceptor])),
        provideHttpClientTesting(),
        { provide: SubscriptionAccessService, useValue: { openPaywall } },
        {
          provide: StoreAvailabilityService,
          useValue: { reopen: jasmine.createSpy('reopen') },
        },
        { provide: PlanPaywallService, useValue: { showFromApi } },
        { provide: Router, useValue: routerStub },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  /** Fires the request, answers the enforce 403 and returns what the caller got. */
  function refuse(url: string): { status?: number } | null {
    let caught: { status?: number } | null = null;
    http.post(url, {}).subscribe({
      next: () => undefined,
      error: (err: { status?: number }) => (caught = err),
    });
    httpMock.expectOne(url).flush(
      {
        statusCode: 403,
        error_code: 'PLAN_MODULE_NOT_INCLUDED',
        message: 'Tu plan actual no incluye este módulo.',
        details: DETAILS,
      },
      { status: 403, statusText: 'Forbidden' },
    );
    return caught;
  }

  it('withholding preview refused in the POS: no paywall, error re-thrown, event logged', () => {
    const caught = refuse(PREVIEW_URL);

    expect(showFromApi).not.toHaveBeenCalled();
    expect(openPaywall).not.toHaveBeenCalled();
    expect(caught?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith(
      jasmine.stringMatching(/PLAN_MODULE_NOT_INCLUDED during a sale.*withholding-tax\/preview/),
    );
  });

  it('an unknown gated endpoint refused while the POS is open: no paywall', () => {
    refuse(NEW_GATED_URL);

    expect(showFromApi).not.toHaveBeenCalled();
  });

  it('«Cobrar» on an order detail: no paywall', () => {
    routerStub.url = '/admin/orders/41';

    refuse(NEW_GATED_URL);

    expect(showFromApi).not.toHaveBeenCalled();
  });

  it('a sale endpoint refused outside a sale screen: no paywall either', () => {
    routerStub.url = '/admin/customers';

    refuse(PREVIEW_URL);

    expect(showFromApi).not.toHaveBeenCalled();
  });

  it('outside a sale the module paywall still opens (control)', () => {
    routerStub.url = '/admin/accounting/journal-entries';

    const caught = refuse(NEW_GATED_URL);

    expect(showFromApi).toHaveBeenCalledOnceWith(DETAILS);
    expect(warn).not.toHaveBeenCalled();
    expect(caught?.status).toBe(403);
  });
});
