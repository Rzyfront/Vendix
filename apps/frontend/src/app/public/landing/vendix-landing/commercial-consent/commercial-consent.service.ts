import {
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { environment } from '../../../../../environments/environment';
import {
  VitalsCollector,
  startVitalsCollector,
  vitalEventParams,
} from './commercial-web-vitals';

/**
 * Consentimiento de analítica de la web comercial (SEO-TECH-06 / OPS-06 1.1-1.5).
 *
 * GA4 no se carga ni recibe nada hasta que el visitante pulsa «Aceptar». La
 * elección vive en localStorage (no en una cookie propia) y caduca a los 6 meses.
 * Este servicio es la única puerta para cualquier evento comercial futuro.
 */

export const CONSENT_STORAGE_KEY = 'vendix-consent-v1';
export const CONSENT_VERSION = 1;
export const CONSENT_MONTHS = 6;
export const COMMERCIAL_HOSTS = ['vendix.online', 'www.vendix.online'];
export const COMMERCIAL_ANALYTICS_SCRIPT_ID = 'vendix-commercial-analytics';

const COMMERCIAL_CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
];

export interface StoredConsent {
  analytics: boolean;
  version: number;
  decidedAt: string;
}

export type ConsentWindow = {
  location: Pick<Location, 'hostname' | 'pathname' | 'origin' | 'search'>;
  localStorage: Storage;
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  addEventListener?: Window['addEventListener'];
  removeEventListener?: Window['removeEventListener'];
  PerformanceObserver?: typeof PerformanceObserver;
} & Record<string, unknown>;

export const COMMERCIAL_CONSENT_WINDOW = new InjectionToken<ConsentWindow | null>(
  'COMMERCIAL_CONSENT_WINDOW',
  {
    providedIn: 'root',
    factory: () =>
      isPlatformBrowser(inject(PLATFORM_ID))
        ? (inject(DOCUMENT).defaultView as unknown as ConsentWindow | null)
        : null,
  },
);

export const COMMERCIAL_ANALYTICS_ID = new InjectionToken<string>(
  'COMMERCIAL_ANALYTICS_ID',
  { providedIn: 'root', factory: () => environment.commercialAnalyticsId },
);

export function consentExpiresAt(decidedAt: Date): Date {
  const expires = new Date(decidedAt.getTime());
  expires.setUTCMonth(expires.getUTCMonth() + CONSENT_MONTHS);
  return expires;
}

/** Lee la elección guardada; si no existe, es inválida o ya caducó devuelve null. */
export function parseStoredConsent(
  raw: string | null,
  now: Date,
): StoredConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredConsent> | null;
    if (
      !value ||
      typeof value.analytics !== 'boolean' ||
      value.version !== CONSENT_VERSION ||
      typeof value.decidedAt !== 'string'
    ) {
      return null;
    }
    const decidedAt = new Date(value.decidedAt);
    if (Number.isNaN(decidedAt.getTime())) return null;
    if (consentExpiresAt(decidedAt).getTime() <= now.getTime()) return null;
    return {
      analytics: value.analytics,
      version: value.version,
      decidedAt: value.decidedAt,
    };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class CommercialConsentService {
  private readonly win = inject(COMMERCIAL_CONSENT_WINDOW);
  private readonly document = inject(DOCUMENT);
  private readonly measurementId = inject(COMMERCIAL_ANALYTICS_ID);

  /** true/false = elección vigente; null = todavía no ha elegido. */
  private readonly choice = signal<boolean | null>(null);
  private readonly attached = signal(false);
  private readonly bannerRequested = signal(false);

  /** Puerta para cualquier evento comercial (page_view hoy; cta_click, etc. mañana). */
  readonly analyticsAllowed = computed(
    () => this.attached() && this.choice() === true,
  );
  /** El aviso y el enlace del pie solo existen en la portada comercial. */
  readonly available = this.attached.asReadonly();
  readonly bannerVisible = computed(
    () => this.attached() && (this.choice() === null || this.bannerRequested()),
  );
  readonly currentChoice = this.choice.asReadonly();

  private pageViewSent = false;
  /** SEO-TECH-11: RUM de Core Web Vitals, solo con analítica aceptada. */
  private vitals: VitalsCollector | null = null;
  private vitalsSent = false;
  private readonly onPageHidden = (): void => {
    if (this.document.visibilityState === 'hidden') this.flushVitals();
  };
  private readonly onPageHide = (): void => this.flushVitals();

  /**
   * La portada comercial se registra al iniciar. Devuelve la función que la
   * desconecta al salir para que GA no mida otras rutas de la SPA.
   */
  attach(): () => void {
    const win = this.win;
    if (!win || !this.measurementId) return () => undefined;
    if (
      !COMMERCIAL_HOSTS.includes(win.location.hostname) ||
      win.location.pathname !== '/'
    ) {
      return () => undefined;
    }

    this.pageViewSent = false;
    this.vitalsSent = false;
    this.bannerRequested.set(false);
    this.choice.set(this.readChoice());
    this.attached.set(true);
    if (this.choice() === true) this.startMeasurement();

    return () => this.detach();
  }

  accept(): void {
    this.decide(true);
  }

  reject(): void {
    this.decide(false);
  }

  /** «Preferencias de cookies» en el pie: vuelve a mostrar el aviso. */
  openPreferences(): void {
    if (this.attached()) this.bannerRequested.set(true);
  }

  private decide(analytics: boolean): void {
    if (!this.attached()) return;
    this.writeChoice(analytics);
    this.choice.set(analytics);
    this.bannerRequested.set(false);
    if (analytics) {
      this.startMeasurement();
    } else {
      this.stopMeasurement();
    }
  }

  private detach(): void {
    if (!this.attached()) return;
    // Al salir de la portada por la SPA, la visita a la portada terminó: se envían sus métricas.
    this.flushVitals();
    this.attached.set(false);
    this.bannerRequested.set(false);
    // Fuera de la portada GA no debe medir nada, haya aceptado o no.
    this.setDisabled(true);
  }

  private startMeasurement(): void {
    const win = this.win;
    if (!win || !this.attached() || this.pageViewSent) return;

    // La analítica nunca puede romper la portada.
    try {
      win.dataLayer ??= [];
      if (!win.gtag) {
        win.gtag = function () {
          // gtag.js exige el objeto `arguments`, no un array.
          // eslint-disable-next-line prefer-rest-params
          win.dataLayer!.push(arguments);
        };
        win.gtag('consent', 'default', {
          analytics_storage: 'denied',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          wait_for_update: 500,
        });
      }
      this.setDisabled(false);
      win.gtag('consent', 'update', { analytics_storage: 'granted' });

      if (!this.document.getElementById(COMMERCIAL_ANALYTICS_SCRIPT_ID)) {
        win.gtag('js', new Date());
        const script = this.document.createElement('script');
        script.id = COMMERCIAL_ANALYTICS_SCRIPT_ID;
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${this.measurementId}`;
        this.document.head.appendChild(script);
      }

      const pageLocation = this.pageLocation(win);
      // SEO-TECH-06: antes las cookies iban a «.vendix.online» y las veían todas las
      // tiendas (subdominios). Se borran esas cookies de dominio y GA escribe solo en
      // este host (cookie_domain: 'none').
      this.deleteDomainAnalyticsCookies(win.location.hostname);
      win.gtag('config', this.measurementId, {
        send_page_view: false,
        page_location: pageLocation,
        page_referrer: this.document.referrer.split(/[?#]/)[0],
        cookie_domain: 'none',
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      win.gtag('event', 'page_view', {
        send_to: this.measurementId,
        page_location: pageLocation,
        page_title: 'Vendix — Web comercial',
      });
      this.pageViewSent = true;
      this.startVitals(win);
    } catch {
      // Un bloqueador de etiquetas no puede impedir ver precios ni navegar.
    }
  }

  private stopMeasurement(): void {
    const win = this.win;
    if (!win) return;
    this.stopVitals();
    try {
      this.setDisabled(true);
      win.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      this.deleteAnalyticsCookies(win.location.hostname);
    } catch {
      // Igual que al cargar: fallar en silencio.
    }
  }

  private startVitals(win: ConsentWindow): void {
    if (this.vitals || this.vitalsSent) return;
    this.vitals = startVitalsCollector(win);
    win.addEventListener?.('visibilitychange', this.onPageHidden, true);
    win.addEventListener?.('pagehide', this.onPageHide, true);
  }

  /** Envía LCP, CLS e INP una sola vez por visita a la portada, y solo con consentimiento. */
  private flushVitals(): void {
    const win = this.win;
    const vitals = this.vitals;
    if (!win || !vitals || this.vitalsSent) return;
    if (this.analyticsAllowed()) {
      try {
        for (const sample of vitals.samples()) {
          win.gtag?.('event', sample.name, vitalEventParams(sample, this.measurementId));
        }
      } catch {
        // La medición nunca puede romper la portada.
      }
    }
    this.vitalsSent = true;
    this.stopVitals();
  }

  private stopVitals(): void {
    this.vitals?.stop();
    this.vitals = null;
    this.win?.removeEventListener?.('visibilitychange', this.onPageHidden, true);
    this.win?.removeEventListener?.('pagehide', this.onPageHide, true);
  }

  private setDisabled(disabled: boolean): void {
    if (this.win) this.win[`ga-disable-${this.measurementId}`] = disabled;
  }

  /** Borra solo las cookies de GA con atributo Domain (las heredadas de cookie_domain = host). */
  private deleteDomainAnalyticsCookies(hostname: string): void {
    const suffix = this.measurementId.replace(/^G-/, '');
    const apex = hostname.replace(/^www\./, '');
    for (const name of ['_ga', `_ga_${suffix}`]) {
      for (const domain of new Set([hostname, `.${hostname}`, `.${apex}`])) {
        this.document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
      }
    }
  }

  private deleteAnalyticsCookies(hostname: string): void {
    const suffix = this.measurementId.replace(/^G-/, '');
    const names = ['_ga', `_ga_${suffix}`];
    const apex = hostname.replace(/^www\./, '');
    const domains = ['', hostname, `.${hostname}`, `.${apex}`];
    for (const name of names) {
      for (const domain of new Set(domains)) {
        this.document.cookie =
          `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` +
          (domain ? `; domain=${domain}` : '');
      }
    }
  }

  // Keep only campaign parameters so GA4 can attribute the visit; any other
  // query param is dropped to avoid leaking tokens or personal data.
  private pageLocation(win: ConsentWindow): string {
    const params = new URLSearchParams(win.location.search);
    const campaignQuery = COMMERCIAL_CAMPAIGN_PARAMS.filter((key) =>
      params.has(key),
    )
      .map((key) => `${key}=${encodeURIComponent(params.get(key)!)}`)
      .join('&');
    return win.location.origin + '/' + (campaignQuery ? `?${campaignQuery}` : '');
  }

  private readChoice(): boolean | null {
    const storage = this.storage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(CONSENT_STORAGE_KEY);
      const stored = parseStoredConsent(raw, new Date());
      if (!stored && raw !== null) storage.removeItem(CONSENT_STORAGE_KEY);
      return stored ? stored.analytics : null;
    } catch {
      return null;
    }
  }

  private writeChoice(analytics: boolean): void {
    const storage = this.storage();
    if (!storage) return;
    const value: StoredConsent = {
      analytics,
      version: CONSENT_VERSION,
      decidedAt: new Date().toISOString(),
    };
    try {
      storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Navegación privada o almacenamiento lleno: la elección vale para esta visita.
    }
  }

  private storage(): Storage | null {
    try {
      return this.win?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
