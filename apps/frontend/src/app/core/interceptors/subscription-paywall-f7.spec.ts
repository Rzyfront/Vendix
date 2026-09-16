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

const AI_URL = `${environment.apiUrl}/store/ai-chat/conversations/9/messages`;
const PLAIN_URL = `${environment.apiUrl}/store/products`;

describe('subscriptionPaywallInterceptor — F7 feature + sugerencia (005/006)', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let openPaywall: jasmine.Spy;
  let loadUpgradeSuggestion: jasmine.Spy;
  let routerStub: { url: string };

  beforeEach(() => {
    openPaywall = jasmine.createSpy('openPaywall');
    loadUpgradeSuggestion = jasmine.createSpy('loadUpgradeSuggestion');
    routerStub = { url: '/admin/products' };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([subscriptionPaywallInterceptor])),
        provideHttpClientTesting(),
        {
          provide: SubscriptionAccessService,
          useValue: { openPaywall, loadUpgradeSuggestion },
        },
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

  function failWith(
    url: string,
    code: string,
    status = 429,
    details: Record<string, unknown> = { subscription_state: 'active' },
  ): void {
    http.post(url, {}).subscribe({
      next: () => undefined,
      error: () => undefined,
    });
    httpMock.expectOne(url).flush(
      {
        statusCode: status,
        error_code: code,
        message: 'AI quota exceeded for this billing period',
        details,
      },
      { status, statusText: 'Too Many Requests' },
    );
  }

  it('006 en ruta IA: adjunta la feature inferida y pide la sugerencia', () => {
    failWith(AI_URL, 'SUBSCRIPTION_006');

    expect(openPaywall).toHaveBeenCalledTimes(1);
    expect(openPaywall).toHaveBeenCalledWith(
      'SUBSCRIPTION_006',
      'AI quota exceeded for this billing period',
      { subscription_state: 'active', feature: 'streaming_chat' },
    );
    expect(loadUpgradeSuggestion).toHaveBeenCalledOnceWith('streaming_chat');
  });

  it('respeta la feature que ya trae el backend (no la sobrescribe)', () => {
    failWith(AI_URL, 'SUBSCRIPTION_005', 403, {
      subscription_state: 'active',
      feature: 'tool_agents',
    });

    expect(openPaywall).toHaveBeenCalledWith(
      'SUBSCRIPTION_005',
      'AI quota exceeded for this billing period',
      { subscription_state: 'active', feature: 'tool_agents' },
    );
    expect(loadUpgradeSuggestion).toHaveBeenCalledOnceWith('tool_agents');
  });

  it('006 en ruta no-IA: pasa details intactos y no pide sugerencia', () => {
    failWith(PLAIN_URL, 'SUBSCRIPTION_006');

    expect(openPaywall).toHaveBeenCalledWith(
      'SUBSCRIPTION_006',
      'AI quota exceeded for this billing period',
      { subscription_state: 'active' },
    );
    expect(loadUpgradeSuggestion).not.toHaveBeenCalled();
  });

  it('sigue re-lanzando el error original tras abrir el paywall 006', () => {
    let caught: unknown = null;
    http.post(AI_URL, {}).subscribe({
      next: () => undefined,
      error: (err: unknown) => (caught = err),
    });
    httpMock.expectOne(AI_URL).flush(
      { statusCode: 429, error_code: 'SUBSCRIPTION_006', details: {} },
      { status: 429, statusText: 'Too Many Requests' },
    );

    expect(caught).toBeTruthy();
  });
});
