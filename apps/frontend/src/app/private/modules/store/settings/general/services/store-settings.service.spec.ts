import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Store } from '@ngrx/store';

import { StoreSettingsService } from './store-settings.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes';
import { environment } from '../../../../../../../environments/environment';

/** Access token whose payload carries the given `store_id` claim. */
function tokenFor(store_id: number | null): string {
  const payload = btoa(JSON.stringify({ sub: 1, store_id }));
  return `header.${payload}.signature`;
}

/**
 * QUI-563 Fase 4: la caché de settings pertenece a la tienda que la cargó.
 * Cambiar de tienda es una transición SPA (el servicio sobrevive), así que
 * ni un acierto de caché ni un error de lectura pueden devolver los settings
 * de la tienda anterior.
 */
describe('StoreSettingsService cache per store (QUI-563)', () => {
  const url = `${environment.apiUrl}/store/settings`;
  const settingsA = { success: true, data: { general: { currency: 'COP' } } };
  const settingsB = { success: true, data: { general: { currency: 'USD' } } };

  let service: StoreSettingsService;
  let http: HttpTestingController;
  const accessToken = signal<string | null>(tokenFor(10));

  beforeEach(() => {
    accessToken.set(tokenFor(10));
    TestBed.configureTestingModule({
      providers: [
        StoreSettingsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Store,
          useValue: {
            dispatch: jasmine.createSpy('dispatch'),
            selectSignal: () => accessToken,
          },
        },
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrencyForCode: () => Promise.resolve() },
        },
      ],
    });
    service = TestBed.inject(StoreSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function loadStoreA(): void {
    service.getSettings().subscribe();
    http.expectOne(url).flush(settingsA);
  }

  it('reads the active store from the access token', () => {
    expect(service.getActiveStoreId()).toBe(10);
    accessToken.set(tokenFor(20));
    expect(service.getActiveStoreId()).toBe(20);
    accessToken.set(tokenFor(null));
    expect(service.getActiveStoreId()).toBeNull();
    accessToken.set('not-a-jwt');
    expect(service.getActiveStoreId()).toBeNull();
  });

  it('serves a fresh cache to the store that loaded it', () => {
    loadStoreA();

    let received: unknown;
    service.getSettings().subscribe((r) => (received = r));

    http.expectNone(url);
    expect(received).toEqual(settingsA);
  });

  it('does not serve store A cache after switching to store B', () => {
    loadStoreA();
    accessToken.set(tokenFor(20));

    let received: unknown;
    service.getSettings().subscribe((r) => (received = r));
    http.expectOne(url).flush(settingsB);

    expect(received).toEqual(settingsB);
  });

  it('does not reuse store A in-flight request for store B', () => {
    service.getSettings().subscribe();
    accessToken.set(tokenFor(20));
    service.getSettings().subscribe();

    const requests = http.match(url);
    expect(requests.length).toBe(2);
    requests.forEach((r, i) => r.flush(i === 0 ? settingsA : settingsB));
  });

  it('a read error for store B propagates instead of returning store A cache', () => {
    loadStoreA();
    accessToken.set(tokenFor(20));

    let received: unknown;
    let failed: unknown;
    service.getSettings({ forceRefresh: true }).subscribe({
      next: (r) => (received = r),
      error: (e) => (failed = e),
    });
    http
      .expectOne(url)
      .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(received).toBeUndefined();
    expect((failed as { status: number }).status).toBe(403);
  });

  it('a read error for the same store still falls back to its own cache', () => {
    loadStoreA();

    let received: unknown;
    service.getSettings({ forceRefresh: true }).subscribe((r) => (received = r));
    http
      .expectOne(url)
      .flush(null, { status: 0, statusText: 'Unknown Error' });

    expect(received).toEqual(settingsA);
  });
});
