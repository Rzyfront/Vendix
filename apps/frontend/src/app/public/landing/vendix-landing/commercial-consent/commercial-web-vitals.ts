/**
 * RUM de Core Web Vitals de la portada comercial (SEO-TECH-11).
 *
 * PageSpeed da laboratorio y CrUX no tiene muestra para vendix.online, así que el
 * criterio de la tarea (p75 LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 medidos en campo)
 * necesita datos propios. Se miden en el navegador con PerformanceObserver (sin
 * librerías) y se envían a GA4 como eventos `LCP`, `CLS` e `INP`, una vez por visita.
 *
 * Solo corre si el visitante aceptó la analítica: lo arranca CommercialConsentService
 * después del page_view. Los observadores usan `buffered: true`, así que también
 * cuentan lo que pasó antes de aceptar. Ningún dato personal: solo el valor y su nota.
 */

export type VitalName = 'LCP' | 'CLS' | 'INP';
export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export interface VitalSample {
  name: VitalName;
  value: number;
  rating: VitalRating;
}

/** Umbrales de web.dev (bueno ≤ primero, malo > segundo). */
const THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
};

export function rateVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = THRESHOLDS[name];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

export interface LayoutShiftLike {
  value: number;
  startTime: number;
  hadRecentInput: boolean;
}

/**
 * CLS = la mayor «ventana de sesión»: cambios separados por menos de 1 s y que no
 * duran más de 5 s en total. Los cambios justo después de una interacción no cuentan.
 */
export function clsFromShifts(shifts: readonly LayoutShiftLike[]): number {
  let max = 0;
  let current = 0;
  let first = 0;
  let last = 0;
  for (const s of shifts) {
    if (s.hadRecentInput) continue;
    if (current > 0 && s.startTime - last < 1000 && s.startTime - first < 5000) {
      current += s.value;
    } else {
      current = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    max = Math.max(max, current);
  }
  return max;
}

export interface EventTimingLike {
  duration: number;
  interactionId?: number;
}

/**
 * INP: la interacción más lenta (por interactionId, la entrada más larga de cada una).
 * Con 50 interacciones o más se descarta una por cada 50, como hace Chrome.
 */
export function inpFromEvents(events: readonly EventTimingLike[]): number | null {
  const byInteraction = new Map<number, number>();
  for (const e of events) {
    if (!e.interactionId) continue;
    byInteraction.set(e.interactionId, Math.max(byInteraction.get(e.interactionId) ?? 0, e.duration));
  }
  if (!byInteraction.size) return null;
  const sorted = [...byInteraction.values()].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
}

export interface VitalsWindow {
  PerformanceObserver?: typeof PerformanceObserver;
}

export interface VitalsCollector {
  /** Valores medidos hasta ahora (LCP e INP pueden faltar). */
  samples(): VitalSample[];
  stop(): void;
}

/** Arranca los observadores. Si el navegador no los soporta, devuelve un colector vacío. */
export function startVitalsCollector(win: VitalsWindow): VitalsCollector {
  let lcp: number | null = null;
  const shifts: LayoutShiftLike[] = [];
  const events: EventTimingLike[] = [];
  const observers: PerformanceObserver[] = [];
  const Observer = win.PerformanceObserver;

  const observe = (type: string, onEntries: (list: PerformanceEntryList) => void, extra: Record<string, unknown> = {}): void => {
    if (!Observer || !(Observer.supportedEntryTypes ?? []).includes(type)) return;
    try {
      const o = new Observer((list) => onEntries(list.getEntries()));
      o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(o);
    } catch {
      // Un navegador viejo o un bloqueador no puede romper la portada.
    }
  };

  observe('largest-contentful-paint', (entries) => {
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) lcp = lastEntry.startTime;
  });
  observe('layout-shift', (entries) => {
    for (const e of entries) shifts.push(e as unknown as LayoutShiftLike);
  });
  observe('event', (entries) => {
    for (const e of entries) events.push(e as unknown as EventTimingLike);
  }, { durationThreshold: 40 });

  return {
    samples() {
      const out: VitalSample[] = [];
      const add = (name: VitalName, value: number | null): void => {
        if (value === null || !Number.isFinite(value)) return;
        out.push({ name, value, rating: rateVital(name, value) });
      };
      add('LCP', lcp);
      add('CLS', observers.length ? clsFromShifts(shifts) : null);
      add('INP', inpFromEvents(events));
      return out;
    },
    stop() {
      for (const o of observers) o.disconnect();
      observers.length = 0;
    },
  };
}

/** Parámetros del evento de GA4 (sin datos personales). */
export interface VitalEventParams {
  send_to: string;
  /** Entero, como pide GA: ms para LCP e INP; CLS × 1000. */
  value: number;
  metric_value: number;
  metric_rating: VitalRating;
  non_interaction: true;
}

/** Parámetros del evento de GA4. `value` va en ms (CLS × 1000) y entero, como pide GA. */
export function vitalEventParams(sample: VitalSample, sendTo: string): VitalEventParams {
  return {
    send_to: sendTo,
    value: Math.round(sample.name === 'CLS' ? sample.value * 1000 : sample.value),
    metric_value: sample.name === 'CLS' ? Math.round(sample.value * 10000) / 10000 : Math.round(sample.value),
    metric_rating: sample.rating,
    non_interaction: true,
  };
}
