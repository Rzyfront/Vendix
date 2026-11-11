import { TestBed } from '@angular/core/testing';
import { buildTimerView } from '../components/production-active/production-timer.util';
import { ProductionClockService } from './production-clock.service';

/** S25 (release #1134): el cronómetro corrige el desfase del reloj del equipo. */
describe('ProductionClockService — S25', () => {
  let clock: ProductionClockService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    clock = TestBed.inject(ProductionClockService);
  });

  it('sin server_now el desfase es 0', () => {
    clock.sync(undefined);
    expect(clock.offsetMs()).toBe(0);
    clock.sync('no es una fecha');
    expect(clock.offsetMs()).toBe(0);
  });

  it('un equipo adelantado 5 minutos muestra el mismo tiempo transcurrido que uno en hora', () => {
    const serverMs = Date.parse('2026-11-10T15:00:00.000Z');
    const startedAt = '2026-11-10T14:50:00.000Z';
    const fiveMin = 5 * 60 * 1000;

    // Equipo adelantado: su reloj local marca serverMs + 5 min al recibir la respuesta.
    clock.sync(new Date(serverMs).toISOString(), serverMs + fiveMin);
    expect(clock.offsetMs()).toBe(-fiveMin);

    // 30 s después, el equipo adelantado marca (serverMs + 30 s + 5 min).
    const skewedLocalNow = serverMs + 30_000 + fiveMin;
    const corrected = skewedLocalNow + clock.offsetMs();
    const inSync = serverMs + 30_000;

    const skewedView = buildTimerView(startedAt, null, corrected);
    const referenceView = buildTimerView(startedAt, null, inSync);
    expect(skewedView?.text).toBe('10:30');
    expect(skewedView).toEqual(referenceView);
    // Sin la corrección marcaría 15:30.
    expect(buildTimerView(startedAt, null, skewedLocalNow)?.text).toBe('15:30');
  });

  it('now() suma el desfase a la hora local', () => {
    const before = Date.now();
    clock.sync(new Date(Date.now() + 60_000).toISOString());
    const now = clock.now();
    expect(now).toBeGreaterThanOrEqual(before + 59_000);
    expect(now).toBeLessThanOrEqual(Date.now() + 61_000);
  });
});
