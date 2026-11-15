import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import {
  COMMERCIAL_ANALYTICS_ID,
  COMMERCIAL_ANALYTICS_SCRIPT_ID,
  COMMERCIAL_CONSENT_WINDOW,
  CONSENT_STORAGE_KEY,
  CommercialConsentService,
  ConsentWindow,
  consentExpiresAt,
  parseStoredConsent,
} from './commercial-consent.service';

const ID = 'G-TEST123';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function fakeWindow(hostname = 'vendix.online', pathname = '/'): ConsentWindow {
  return {
    location: {
      hostname,
      pathname,
      origin: `https://${hostname}`,
      search: '?utm_source=ig&email=a@b.co',
    },
    localStorage: new MemoryStorage(),
  } as ConsentWindow;
}

/** Llamadas a gtag como arrays: [comando, ...args]. */
function gtagCalls(win: ConsentWindow): unknown[][] {
  return (win.dataLayer ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );
}

function pageViews(win: ConsentWindow): unknown[][] {
  return gtagCalls(win).filter((c) => c[0] === 'event' && c[1] === 'page_view');
}

describe('CommercialConsentService (SEO-TECH-06)', () => {
  let win: ConsentWindow;
  let doc: Document;
  let cookieWrites: string[];

  function setup(w: ConsentWindow = win): CommercialConsentService {
    win = w;
    TestBed.configureTestingModule({
      providers: [
        { provide: COMMERCIAL_CONSENT_WINDOW, useValue: win },
        { provide: COMMERCIAL_ANALYTICS_ID, useValue: ID },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
    return TestBed.inject(CommercialConsentService);
  }

  function gtagScript(): Element | null {
    return doc.getElementById(COMMERCIAL_ANALYTICS_SCRIPT_ID);
  }

  beforeEach(() => {
    win = fakeWindow();
    doc = document.implementation.createHTMLDocument('Vendix');
    cookieWrites = [];
    Object.defineProperty(doc, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => cookieWrites.push(value),
    });
  });

  afterEach(() => jasmine.clock().uninstall());

  it('no inserta gtag.js ni envía nada antes de que el visitante elija', () => {
    const service = setup();
    service.attach();

    expect(gtagScript()).toBeNull();
    expect(win.dataLayer).toBeUndefined();
    expect(win.gtag).toBeUndefined();
    expect(service.bannerVisible()).toBeTrue();
    expect(service.analyticsAllowed()).toBeFalse();
  });

  it('rechazar no carga nada y guarda la elección', () => {
    const service = setup();
    service.attach();
    service.reject();

    expect(gtagScript()).toBeNull();
    expect(pageViews(win).length).toBe(0);
    expect(service.bannerVisible()).toBeFalse();
    const stored = JSON.parse(win.localStorage.getItem(CONSENT_STORAGE_KEY)!);
    expect(stored.analytics).toBeFalse();
  });

  it('aceptar carga gtag.js una sola vez y envía un único page_view sin datos personales', () => {
    const service = setup();
    service.attach();
    service.accept();
    service.accept();

    expect(doc.querySelectorAll(`#${COMMERCIAL_ANALYTICS_SCRIPT_ID}`).length).toBe(1);
    expect(gtagScript()?.getAttribute('src')).toContain(`id=${ID}`);
    expect(pageViews(win).length).toBe(1);

    const calls = gtagCalls(win);
    const firstConsent = calls.findIndex((c) => c[0] === 'consent');
    const firstConfig = calls.findIndex((c) => c[0] === 'config');
    expect(calls[firstConsent]).toEqual([
      'consent',
      'default',
      jasmine.objectContaining({ analytics_storage: 'denied', ad_storage: 'denied' }),
    ]);
    expect(firstConsent).toBeLessThan(firstConfig);
    expect(calls).toContain(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(pageViews(win)[0][2]).toEqual(
      jasmine.objectContaining({ page_location: 'https://vendix.online/?utm_source=ig' }),
    );
    expect(win[`ga-disable-${ID}`]).toBeFalse();
    expect(service.analyticsAllowed()).toBeTrue();
  });

  it('respeta la aceptación guardada al volver y no muestra el aviso', () => {
    const first = setup();
    first.attach();
    first.accept();

    TestBed.resetTestingModule();
    const returning = fakeWindow();
    returning.localStorage = win.localStorage;
    doc = document.implementation.createHTMLDocument('Vendix');
    const service = setup(returning);
    service.attach();

    expect(service.bannerVisible()).toBeFalse();
    expect(gtagScript()).not.toBeNull();
    expect(pageViews(returning).length).toBe(1);
  });

  it('SEO-TECH-06: GA escribe sus cookies solo en vendix.online, no en las tiendas', () => {
    const service = setup();
    service.attach();
    service.accept();
    const calls = gtagCalls(win);
    const config = calls.find((c) => c[0] === 'config');
    expect((config?.[2] as Record<string, unknown>)['cookie_domain']).toBe('none');
    // Las cookies heredadas con Domain (visibles en *.vendix.online) se borran antes del config.
    expect(cookieWrites.some((c) => c.startsWith('_ga=;') && c.includes('domain=.vendix.online'))).toBeTrue();
    expect(cookieWrites.filter((c) => c.startsWith('_ga') && !c.includes('domain=')).length).toBe(0);
  });

  it('revocar desde «Preferencias de cookies» desactiva GA, borra sus cookies y no vuelve a enviar', () => {
    const service = setup();
    service.attach();
    service.accept();

    service.openPreferences();
    expect(service.bannerVisible()).toBeTrue();
    service.reject();

    expect(win[`ga-disable-${ID}`]).toBeTrue();
    expect(gtagCalls(win)).toContain(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(cookieWrites.some((c) => c.startsWith('_ga=;'))).toBeTrue();
    expect(cookieWrites.some((c) => c.startsWith('_ga_TEST123=;'))).toBeTrue();
    expect(service.analyticsAllowed()).toBeFalse();

    service.openPreferences();
    service.reject();
    expect(pageViews(win).length).toBe(1);
  });

  it('salir de la portada desactiva GA aunque haya aceptado', () => {
    const service = setup();
    const detach = service.attach();
    service.accept();
    detach();

    expect(win[`ga-disable-${ID}`]).toBeTrue();
    expect(service.available()).toBeFalse();
  });

  it('no aparece fuera de la portada comercial (tiendas, panel, otras rutas)', () => {
    for (const w of [
      fakeWindow('mitienda.vendix.online'),
      fakeWindow('vendix.com'),
      fakeWindow('vendix.online', '/admin'),
    ]) {
      TestBed.resetTestingModule();
      doc = document.implementation.createHTMLDocument('Vendix');
      const service = setup(w);
      service.attach();
      service.accept();

      expect(service.available()).toBeFalse();
      expect(service.bannerVisible()).toBeFalse();
      expect(gtagScript()).toBeNull();
      expect(w.dataLayer).toBeUndefined();
    }
  });

  it('vuelve a preguntar cuando la elección cumple 6 meses', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-01-15T10:00:00Z'));
    const service = setup();
    service.attach();
    service.accept();

    TestBed.resetTestingModule();
    jasmine.clock().mockDate(new Date('2026-07-15T10:00:01Z'));
    const later = fakeWindow();
    later.localStorage = win.localStorage;
    doc = document.implementation.createHTMLDocument('Vendix');
    const again = setup(later);
    again.attach();

    expect(again.bannerVisible()).toBeTrue();
    expect(gtagScript()).toBeNull();
    expect(later.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('si localStorage falla, no rompe y simplemente vuelve a preguntar', () => {
    const broken = fakeWindow();
    Object.defineProperty(broken, 'localStorage', {
      get: () => {
        throw new Error('SecurityError');
      },
    });
    const service = setup(broken);

    expect(() => service.attach()).not.toThrow();
    expect(service.bannerVisible()).toBeTrue();
    expect(() => service.accept()).not.toThrow();
    expect(pageViews(broken).length).toBe(1);
  });
});

describe('CommercialConsentService: RUM de Core Web Vitals (SEO-TECH-11)', () => {
  let win: ConsentWindow;
  let listeners: Map<string, () => void>;

  function vitalsWindow(): ConsentWindow {
    const w = fakeWindow();
    listeners = new Map();
    const buffer: Record<string, unknown[]> = {
      'largest-contentful-paint': [{ startTime: 2100 }],
      'layout-shift': [{ value: 0.05, startTime: 10, hadRecentInput: false }],
      event: [],
    };
    class FakeObserver {
      static supportedEntryTypes = Object.keys(buffer);
      constructor(private readonly cb: (list: { getEntries: () => unknown[] }) => void) {}
      observe(init: { type: string }): void {
        this.cb({ getEntries: () => buffer[init.type] ?? [] });
      }
      disconnect(): void {}
    }
    w.PerformanceObserver = FakeObserver as unknown as typeof PerformanceObserver;
    w.addEventListener = ((type: string, fn: () => void) => listeners.set(type, fn)) as unknown as Window['addEventListener'];
    w.removeEventListener = ((type: string) => listeners.delete(type)) as unknown as Window['removeEventListener'];
    return w;
  }

  function setup(): CommercialConsentService {
    const doc = document.implementation.createHTMLDocument('Vendix');
    Object.defineProperty(doc, 'cookie', { configurable: true, get: () => '', set: () => undefined });
    TestBed.configureTestingModule({
      providers: [
        { provide: COMMERCIAL_CONSENT_WINDOW, useValue: win },
        { provide: COMMERCIAL_ANALYTICS_ID, useValue: ID },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
    return TestBed.inject(CommercialConsentService);
  }

  const vitalEvents = (): unknown[][] =>
    gtagCalls(win).filter((c) => c[0] === 'event' && ['LCP', 'CLS', 'INP'].includes(c[1] as string));

  beforeEach(() => (win = vitalsWindow()));

  it('con analítica aceptada envía LCP y CLS una sola vez al ocultar la página', () => {
    const service = setup();
    service.attach();
    service.accept();
    expect(vitalEvents().length).toBe(0);

    listeners.get('pagehide')!();
    listeners.get('pagehide')?.();

    expect(vitalEvents().map((c) => c[1])).toEqual(['LCP', 'CLS']);
    const lcp = vitalEvents()[0][2] as Record<string, unknown>;
    expect(lcp['value']).toBe(2100);
    expect(lcp['metric_rating']).toBe('good');
    expect(lcp['send_to']).toBe(ID);
  });

  it('al salir de la portada por la SPA envía las métricas antes de desactivar GA', () => {
    const service = setup();
    const detach = service.attach();
    service.accept();
    detach();
    expect(vitalEvents().length).toBe(2);
  });

  it('sin aceptar, o después de revocar, no mide ni envía nada', () => {
    const service = setup();
    service.attach();
    expect(listeners.size).toBe(0);
    service.accept();
    service.openPreferences();
    service.reject();
    expect(listeners.size).toBe(0);
    expect(vitalEvents().length).toBe(0);
  });
});

describe('parseStoredConsent', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('acepta una elección vigente', () => {
    const raw = JSON.stringify({ analytics: true, version: 1, decidedAt: '2026-06-01T00:00:00Z' });
    expect(parseStoredConsent(raw, now)?.analytics).toBeTrue();
  });

  it('descarta elecciones caducadas, de otra versión o corruptas', () => {
    expect(
      parseStoredConsent(
        JSON.stringify({ analytics: true, version: 1, decidedAt: '2026-04-27T00:00:00Z' }),
        now,
      ),
    ).toBeNull();
    expect(
      parseStoredConsent(
        JSON.stringify({ analytics: true, version: 2, decidedAt: '2026-10-01T00:00:00Z' }),
        now,
      ),
    ).toBeNull();
    expect(parseStoredConsent('{no-json', now)).toBeNull();
    expect(parseStoredConsent(null, now)).toBeNull();
  });

  it('caduca exactamente a los 6 meses calendario', () => {
    expect(consentExpiresAt(new Date('2026-01-15T10:00:00Z')).toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
  });
});
