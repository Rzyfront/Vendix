import {
  clsFromShifts,
  inpFromEvents,
  rateVital,
  startVitalsCollector,
  vitalEventParams,
} from './commercial-web-vitals';

/** PerformanceObserver falso: entrega las entradas «buffered» al observar. */
function fakeObserver(buffer: Record<string, unknown[]>, supported = Object.keys(buffer)) {
  const instances: { disconnected: boolean }[] = [];
  class FakeObserver {
    static supportedEntryTypes = supported;
    disconnected = false;
    constructor(private readonly cb: (list: { getEntries: () => unknown[] }) => void) {
      instances.push(this);
    }
    observe(init: { type: string }): void {
      const entries = buffer[init.type] ?? [];
      this.cb({ getEntries: () => entries });
    }
    disconnect(): void {
      this.disconnected = true;
    }
  }
  return { Observer: FakeObserver as unknown as typeof PerformanceObserver, instances };
}

describe('commercial web vitals (SEO-TECH-11)', () => {
  it('rates with the web.dev thresholds', () => {
    expect(rateVital('LCP', 2500)).toBe('good');
    expect(rateVital('LCP', 2501)).toBe('needs-improvement');
    expect(rateVital('LCP', 4001)).toBe('poor');
    expect(rateVital('INP', 200)).toBe('good');
    expect(rateVital('INP', 600)).toBe('poor');
    expect(rateVital('CLS', 0.1)).toBe('good');
    expect(rateVital('CLS', 0.238)).toBe('needs-improvement');
    expect(rateVital('CLS', 0.3)).toBe('poor');
  });

  it('takes the largest session window for CLS and ignores shifts after input', () => {
    expect(
      clsFromShifts([
        { value: 0.05, startTime: 100, hadRecentInput: false },
        { value: 0.05, startTime: 600, hadRecentInput: false }, // misma ventana: 0,10
        { value: 0.5, startTime: 900, hadRecentInput: true }, // tras una interacción: no cuenta
        { value: 0.08, startTime: 3000, hadRecentInput: false }, // ventana nueva (pausa > 1 s)
      ]),
    ).toBeCloseTo(0.1, 5);
    // Una ventana no pasa de 5 s aunque los cambios sigan llegando.
    const steady = Array.from({ length: 8 }, (_, i) => ({ value: 0.02, startTime: i * 900, hadRecentInput: false }));
    expect(clsFromShifts(steady)).toBeCloseTo(0.12, 5);
    expect(clsFromShifts([])).toBe(0);
  });

  it('takes the slowest interaction for INP, grouping entries by interactionId', () => {
    expect(
      inpFromEvents([
        { duration: 80, interactionId: 1 },
        { duration: 120, interactionId: 1 },
        { duration: 300, interactionId: 2 },
        { duration: 999 }, // sin interactionId (p. ej. hover): no cuenta
      ]),
    ).toBe(300);
    expect(inpFromEvents([])).toBeNull();
    // Con 50 o más interacciones se descarta la más lenta (p98).
    const many = Array.from({ length: 60 }, (_, i) => ({ duration: i === 0 ? 2000 : 100 + i, interactionId: i + 1 }));
    expect(inpFromEvents(many)).toBe(159);
  });

  it('collects buffered LCP, CLS and INP and stops its observers', () => {
    const { Observer, instances } = fakeObserver({
      'largest-contentful-paint': [{ startTime: 1800 }, { startTime: 2600 }],
      'layout-shift': [{ value: 0.03, startTime: 50, hadRecentInput: false }],
      event: [{ duration: 64, interactionId: 7 }],
    });
    const collector = startVitalsCollector({ PerformanceObserver: Observer });
    expect(collector.samples()).toEqual([
      { name: 'LCP', value: 2600, rating: 'needs-improvement' },
      { name: 'CLS', value: 0.03, rating: 'good' },
      { name: 'INP', value: 64, rating: 'good' },
    ]);
    collector.stop();
    expect(instances.every((o) => o.disconnected)).toBeTrue();
  });

  it('reports nothing when the browser has no PerformanceObserver', () => {
    expect(startVitalsCollector({}).samples()).toEqual([]);
    const { Observer } = fakeObserver({}, []);
    expect(startVitalsCollector({ PerformanceObserver: Observer }).samples()).toEqual([]);
  });

  it('builds GA4 params with an integer value (CLS × 1000) and no personal data', () => {
    expect(vitalEventParams({ name: 'CLS', value: 0.23812, rating: 'needs-improvement' }, 'G-X')).toEqual({
      send_to: 'G-X',
      value: 238,
      metric_value: 0.2381,
      metric_rating: 'needs-improvement',
      non_interaction: true,
    });
    expect(vitalEventParams({ name: 'LCP', value: 1834.6, rating: 'good' }, 'G-X').value).toBe(1835);
  });
});
