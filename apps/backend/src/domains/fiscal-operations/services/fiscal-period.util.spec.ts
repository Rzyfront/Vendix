import {
  buildDateRangeFilter,
  resolveFiscalPeriodRange,
} from './fiscal-period.util';

describe('fiscal-period.util', () => {
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  describe('resolveFiscalPeriodRange', () => {
    it('resolves every monthly period in UTC, including leap February', () => {
      for (let month = 1; month <= 12; month++) {
        const period = resolveFiscalPeriodRange({
          period_year: 2024,
          period_month: month,
          periodicity: 'monthly',
        });
        expect(iso(period.period_start)).toBe(`2024-${String(month).padStart(2, '0')}-01`);
        const lastDay = new Date(Date.UTC(2024, month, 0)).getUTCDate();
        expect(iso(period.period_end)).toBe(
          `2024-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        );
        expect(period.period_month).toBe(month);
        expect(period.period_quarter).toBeNull();
      }
    });

    it('normalizes each requested bimonthly month to its closing month', () => {
      for (let requestedMonth = 1; requestedMonth <= 12; requestedMonth++) {
        const period = resolveFiscalPeriodRange({
          period_year: 2025,
          period_month: requestedMonth,
          periodicity: 'bimonthly',
        });
        const closingMonth = Math.ceil(requestedMonth / 2) * 2;
        const startMonth = closingMonth - 1;
        expect(period.period_month).toBe(closingMonth);
        expect(iso(period.period_start)).toBe(
          `2025-${String(startMonth).padStart(2, '0')}-01`,
        );
        const lastDay = new Date(Date.UTC(2025, closingMonth, 0)).getUTCDate();
        expect(iso(period.period_end)).toBe(
          `2025-${String(closingMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        );
      }
    });

    it('normalizes each requested four-month period to its closing month', () => {
      for (let requestedMonth = 1; requestedMonth <= 12; requestedMonth++) {
        const period = resolveFiscalPeriodRange({
          period_year: 2025,
          period_month: requestedMonth,
          periodicity: 'four_monthly',
        });
        const closingMonth = Math.ceil(requestedMonth / 4) * 4;
        const startMonth = closingMonth - 3;
        expect(period.period_month).toBe(closingMonth);
        expect(iso(period.period_start)).toBe(
          `2025-${String(startMonth).padStart(2, '0')}-01`,
        );
        const lastDay = new Date(Date.UTC(2025, closingMonth, 0)).getUTCDate();
        expect(iso(period.period_end)).toBe(
          `2025-${String(closingMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        );
      }
    });

    it('annual periodicity ignores a stale month and normalizes to the full year', () => {
      const period = resolveFiscalPeriodRange({
        period_year: 2024,
        period_month: 2,
        periodicity: 'annual',
      });
      expect(period).toMatchObject({ period_month: null, period_quarter: null });
      expect(iso(period.period_start)).toBe('2024-01-01');
      expect(iso(period.period_end)).toBe('2024-12-31');
    });

    it('accepts matching periodicity and legacy close_type, but rejects conflicts', () => {
      expect(
        resolveFiscalPeriodRange({
          period_year: 2026,
          period_month: 8,
          periodicity: 'bimonthly',
          close_type: 'bimonthly',
        }).period_month,
      ).toBe(8);
      expect(() =>
        resolveFiscalPeriodRange({
          period_year: 2026,
          period_month: 8,
          periodicity: 'bimonthly',
          close_type: 'four_monthly',
        }),
      ).toThrow(RangeError);
    });

    it('preserves legacy quarterly ranges only without explicit periodicity', () => {
      const period = resolveFiscalPeriodRange({
        period_year: 2026,
        period_quarter: 2,
      });
      expect(period.period_month).toBeNull();
      expect(period.period_quarter).toBe(2);
      expect(iso(period.period_start)).toBe('2026-04-01');
      expect(iso(period.period_end)).toBe('2026-06-30');
      expect(() =>
        resolveFiscalPeriodRange({
          period_year: 2026,
          period_quarter: 2,
          periodicity: 'bimonthly',
          period_month: 4,
        }),
      ).toThrow(RangeError);
    });

    it.each([
      ['month zero', { period_month: 0 }],
      ['month thirteen', { period_month: 13 }],
      ['fractional month', { period_month: 1.5 }],
      ['quarter zero', { period_quarter: 0 }],
      ['quarter five', { period_quarter: 5 }],
      ['fractional year', { period_year: 2026.5 }],
      ['year zero', { period_year: 0 }],
      ['year above supported range', { period_year: 10000 }],
      ['unknown periodicity', { periodicity: 'quarterly' }],
      ['unknown close type', { close_type: 'quarterly' }],
    ] as const)('rejects %s instead of silently constructing a date', (_name, values) => {
      expect(() => resolveFiscalPeriodRange({ period_year: 2026, ...values } as any)).toThrow(
        RangeError,
      );
    });

    it.each(['monthly', 'bimonthly', 'four_monthly'] as const)(
      'requires period_month for %s periodicity',
      (periodicity) => {
        expect(() => resolveFiscalPeriodRange({ period_year: 2026, periodicity })).toThrow(
          RangeError,
        );
      },
    );
  });

  it('keeps inclusive date-only period ends as an exclusive next-day filter', () => {
    const period = resolveFiscalPeriodRange({
      period_year: 2024,
      period_month: 2,
      periodicity: 'monthly',
    });
    expect(buildDateRangeFilter(period.period_start, period.period_end)).toEqual({
      gte: new Date('2024-02-01T00:00:00.000Z'),
      lt: new Date('2024-03-01T00:00:00.000Z'),
    });
  });
});
