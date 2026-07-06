/**
 * Smoke tests para `presetToDateRange` (date-range-filter).
 *
 * Cubre los 8 presets + el caso `custom` (que retorna null).
 * La lógica de fechas es crítica porque alimenta TODA la capa de
 * analytics (services + screens). Si esto rompe, todas las
 * consultas de ventas devuelven fechas incorrectas.
 */
import { presetToDateRange } from './preset-to-date-range';

describe('presetToDateRange', () => {
  // Congelamos "hoy" a 2026-07-02 (jueves) para que los tests
  // sean deterministas independientemente del día que corra CI.
  const FIXED_NOW = new Date(2026, 6, 2, 14, 30, 0); // 2026-07-02 14:30 local

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('today → mismo día, preset="today"', () => {
    expect(presetToDateRange('today')).toEqual({
      start_date: '2026-07-02',
      end_date: '2026-07-02',
      preset: 'today',
    });
  });

  it('yesterday → un día antes', () => {
    expect(presetToDateRange('yesterday')).toEqual({
      start_date: '2026-07-01',
      end_date: '2026-07-01',
      preset: 'yesterday',
    });
  });

  it('thisWeek → desde domingo de la misma semana hasta hoy', () => {
    // 2026-07-02 es jueves (getDay() = 4). Domingo = 2026-06-28.
    expect(presetToDateRange('thisWeek')).toEqual({
      start_date: '2026-06-28',
      end_date: '2026-07-02',
      preset: 'thisWeek',
    });
  });

  it('lastWeek → semana completa anterior (7 días antes de thisWeek)', () => {
    // thisWeek start = 2026-06-28 → lastWeek start = 2026-06-21
    // lastWeek end = 2026-06-27 (sábado)
    expect(presetToDateRange('lastWeek')).toEqual({
      start_date: '2026-06-21',
      end_date: '2026-06-27',
      preset: 'lastWeek',
    });
  });

  it('thisMonth → primer día del mes hasta hoy', () => {
    expect(presetToDateRange('thisMonth')).toEqual({
      start_date: '2026-07-01',
      end_date: '2026-07-02',
      preset: 'thisMonth',
    });
  });

  it('lastMonth → mes completo anterior', () => {
    expect(presetToDateRange('lastMonth')).toEqual({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      preset: 'lastMonth',
    });
  });

  it('thisYear → desde 1 de enero hasta hoy', () => {
    expect(presetToDateRange('thisYear')).toEqual({
      start_date: '2026-01-01',
      end_date: '2026-07-02',
      preset: 'thisYear',
    });
  });

  it('lastYear → año completo anterior (1 ene → 31 dic)', () => {
    expect(presetToDateRange('lastYear')).toEqual({
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      preset: 'lastYear',
    });
  });

  it('custom → null (no se puede derivar un rango de un preset custom)', () => {
    expect(presetToDateRange('custom')).toBeNull();
  });

  it('end_date es siempre ≥ start_date (sanity check)', () => {
    const presets = [
      'today', 'yesterday', 'thisWeek', 'lastWeek',
      'thisMonth', 'lastMonth', 'thisYear', 'lastYear',
    ] as const;
    for (const p of presets) {
      const r = presetToDateRange(p);
      expect(r).not.toBeNull();
      expect(r!.end_date >= r!.start_date).toBe(true);
    }
  });
});
