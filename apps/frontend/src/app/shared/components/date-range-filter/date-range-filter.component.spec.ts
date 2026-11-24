import { TestBed } from '@angular/core/testing';
import { DateRangeFilterComponent, DateRangeFilter } from './date-range-filter.component';

/**
 * «Esta semana / Este mes / Este año»: en reportes terminan hoy (no hay datos
 * futuros); en agendas (`presetRange="fullPeriod"`) cubren el periodo completo
 * para no perder citas y pedidos programados después de hoy.
 */
describe('DateRangeFilterComponent — presetRange', () => {
  // Miércoles 18 de noviembre de 2026 (la semana arranca el domingo 15).
  const NOW = new Date(2026, 10, 18, 10, 30);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(NOW);
    TestBed.configureTestingModule({ imports: [DateRangeFilterComponent] });
  });

  afterEach(() => jasmine.clock().uninstall());

  function emitted(preset: string, presetRange?: 'toDate' | 'fullPeriod'): DateRangeFilter {
    const fixture = TestBed.createComponent(DateRangeFilterComponent);
    if (presetRange) fixture.componentRef.setInput('presetRange', presetRange);
    let value: DateRangeFilter | undefined;
    fixture.componentInstance.valueChange.subscribe((v) => (value = v));
    fixture.componentInstance.onPresetChange(preset);
    return value!;
  }

  it('por defecto (reportes) los presets del periodo actual terminan hoy', () => {
    expect(emitted('thisWeek')).toEqual({ start_date: '2026-11-15', end_date: '2026-11-18', preset: 'thisWeek' });
    expect(emitted('thisMonth')).toEqual({ start_date: '2026-11-01', end_date: '2026-11-18', preset: 'thisMonth' });
    expect(emitted('thisYear')).toEqual({ start_date: '2026-01-01', end_date: '2026-11-18', preset: 'thisYear' });
  });

  it('con fullPeriod (agenda) cubren hasta el cierre de la semana, el mes y el año', () => {
    expect(emitted('thisWeek', 'fullPeriod')).toEqual({ start_date: '2026-11-15', end_date: '2026-11-21', preset: 'thisWeek' });
    expect(emitted('thisMonth', 'fullPeriod')).toEqual({ start_date: '2026-11-01', end_date: '2026-11-30', preset: 'thisMonth' });
    expect(emitted('thisYear', 'fullPeriod')).toEqual({ start_date: '2026-01-01', end_date: '2026-12-31', preset: 'thisYear' });
  });

  it('fullPeriod no cambia los presets cerrados ni los de un día', () => {
    expect(emitted('today', 'fullPeriod')).toEqual(emitted('today'));
    expect(emitted('lastWeek', 'fullPeriod')).toEqual(emitted('lastWeek'));
    expect(emitted('lastMonth', 'fullPeriod')).toEqual(emitted('lastMonth'));
    expect(emitted('lastYear', 'fullPeriod')).toEqual(emitted('lastYear'));
  });
});
