import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  HttpClient,
  provideHttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import {
  SubscriptionAccessService,
  UpgradeSuggestion,
} from './subscription-access.service';
import { SubscriptionFacade } from '../store/subscription';
import { environment } from '../../../environments/environment';

const USAGE_URL = `${environment.apiUrl}/store/subscriptions/usage`;
const SUGGEST_URL = `${environment.apiUrl}/store/subscriptions/upgrade-suggestion`;
const PICKER_ROUTE = '/admin/subscription/picker';

const SUGGESTION: UpgradeSuggestion = {
  feature: 'streaming_chat',
  currentPlan: {
    id: 1,
    code: 'starter',
    name: 'Starter',
    price: 49000,
    includes: ['streaming_chat'],
  },
  suggestedPlan: {
    id: 2,
    code: 'pro',
    name: 'Pro',
    price: 99000,
    includes: ['streaming_chat', 'text_generation'],
    cta: PICKER_ROUTE,
  },
};

describe('SubscriptionAccessService — F7 uso + sugerencia de upgrade', () => {
  let service: SubscriptionAccessService;
  let httpMock: HttpTestingController;
  let navigateByUrl: jasmine.Spy;

  beforeEach(() => {
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        SubscriptionAccessService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: SubscriptionFacade,
          useValue: {
            featureMatrix: signal<Record<string, { enabled: boolean }>>({}),
            status: signal('active'),
          },
        },
        { provide: Router, useValue: { url: '/admin/products', navigateByUrl } },
      ],
    });

    service = TestBed.inject(SubscriptionAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('getAiUsage desempaqueta features del envelope', async () => {
    const promise = service.getAiUsage();
    httpMock
      .expectOne(USAGE_URL)
      .flush({
        success: true,
        data: {
          features: {
            streaming_chat: { used: 12, cap: 50, period: 'daily' },
          },
        },
      });

    await expectAsync(promise).toBeResolvedTo({
      streaming_chat: { used: 12, cap: 50, period: 'daily' },
    });
  });

  it('getAiUsage retorna {} ante error HTTP', async () => {
    const promise = service.getAiUsage();
    httpMock
      .expectOne(USAGE_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    await expectAsync(promise).toBeResolvedTo({});
  });

  it('loadUpgradeSuggestion publica la sugerencia en signals', async () => {
    service.loadUpgradeSuggestion('streaming_chat');
    expect(service.suggestionLoading()).toBeTrue();

    httpMock
      .expectOne((req) => req.url === SUGGEST_URL)
      .flush({ success: true, data: SUGGESTION });
    // Macrotask: deja drenar la cadena then/catch/finally del servicio.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.suggestionFeature()).toBe('streaming_chat');
    expect(service.suggestion()?.suggestedPlan?.name).toBe('Pro');
    expect(service.suggestionLoading()).toBeFalse();
  });

  it('loadUpgradeSuggestion ignora feature vacia sin llamar al backend', () => {
    service.loadUpgradeSuggestion(null);
    service.loadUpgradeSuggestion('  ');
    httpMock.expectNone(SUGGEST_URL);
    expect(service.suggestion()).toBeNull();
  });

  it('closePaywall limpia la sugerencia del bloqueo anterior', async () => {
    service.openPaywall('SUBSCRIPTION_006', undefined, {
      subscription_state: 'active',
      feature: 'streaming_chat',
    });
    service.loadUpgradeSuggestion('streaming_chat');
    httpMock
      .expectOne((req) => req.url === SUGGEST_URL)
      .flush({ success: true, data: SUGGESTION });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.suggestion()).not.toBeNull();

    service.closePaywall();

    expect(service.suggestion()).toBeNull();
    expect(service.suggestionFeature()).toBeNull();
    expect(service.suggestionLoading()).toBeFalse();
  });

  it('005 y 006 llevan el CTA al picker (no al catalogo)', () => {
    service.openPaywall('SUBSCRIPTION_005');
    expect(service.paywallState()?.variant.ctaRoute).toBe(PICKER_ROUTE);
    service.triggerCta();
    expect(navigateByUrl).toHaveBeenCalledWith(PICKER_ROUTE);
    service.closePaywall();

    service.openPaywall('SUBSCRIPTION_006');
    expect(service.paywallState()?.variant.ctaRoute).toBe(PICKER_ROUTE);
  });

  it('guarda la feature pedida en details para el bloque del modal', () => {
    service.openPaywall('SUBSCRIPTION_006', undefined, {
      subscription_state: 'active',
      feature: 'streaming_chat',
    });

    expect(service.paywallState()?.details?.feature).toBe('streaming_chat');
  });
});
