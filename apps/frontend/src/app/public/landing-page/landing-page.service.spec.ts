import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TenantFacade } from '../../core/store';
import { LandingPagePublic, LandingPageService, isOwnLandingHost } from './landing-page.service';

const page = (hostname: string): LandingPagePublic => ({
  hostname,
  offer: { mode: 'info', title: 'Asesoría gratis', description: null, product: null },
});

describe('LandingPageService (apps-module Fase 6)', () => {
  let service: LandingPageService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantFacade, useValue: { getCurrentDomainConfig: () => ({ store_id: 10 }) } },
      ],
    });
    service = TestBed.inject(LandingPageService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('la oferta sólo aplica en el dominio propio de la landing', () => {
    expect(isOwnLandingHost(page('roku-landing.vendix.online'), 'Roku-Landing.vendix.online')).toBeTrue();
    expect(isOwnLandingHost(page('roku-landing.vendix.online'), 'roku-store.vendix.online')).toBeFalse();
    expect(isOwnLandingHost(null, 'roku-landing.vendix.online')).toBeFalse();
  });

  it('Apps F5: la oferta también aplica en los alias de la landing', () => {
    const withAlias: LandingPagePublic = {
      ...page('roku-landing.vendix.online'),
      hostnames: ['roku-landing.vendix.online', 'promo.roku.com'],
    };
    expect(isOwnLandingHost(withAlias, 'Promo.Roku.com')).toBeTrue();
    expect(isOwnLandingHost(withAlias, 'roku-store.vendix.online')).toBeFalse();
  });

  it('en el dominio propio expone la landing publicada', () => {
    const host = window.location.hostname;
    service.load().subscribe();

    const req = http.expectOne((r) => r.url.endsWith('/ecommerce/landing-page'));
    expect(req.request.headers.get('x-store-id')).toBe('10');
    req.flush({ data: page(host) });

    expect(service.ownPage()?.offer.title).toBe('Asesoría gratis');
  });

  it('en otro dominio de la tienda (p. ej. {tienda}-store) no hay oferta', () => {
    service.load().subscribe();
    http.expectOne((r) => r.url.endsWith('/ecommerce/landing-page')).flush({ data: page('otro.example.com') });

    expect(service.ownPage()).toBeNull();
  });

  it('sin landing publicada (404) no hay oferta y no falla', () => {
    service.load().subscribe();
    http
      .expectOne((r) => r.url.endsWith('/ecommerce/landing-page'))
      .flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });

    expect(service.ownPage()).toBeNull();
  });

  it('el lead se envía al endpoint de la landing', () => {
    service.submitLead({ first_name: 'Ana', message: 'Quiero info', phone: '3001234567' }).subscribe();

    const req = http.expectOne((r) => r.url.endsWith('/ecommerce/landing-page/lead'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ first_name: 'Ana', message: 'Quiero info', phone: '3001234567' });
    req.flush({ success: true, data: { customer_created: true, customer_id: 1, opportunity_id: 2 } });
  });
});
