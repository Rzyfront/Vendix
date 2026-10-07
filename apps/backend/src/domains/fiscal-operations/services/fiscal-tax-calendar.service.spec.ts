import { BadRequestException } from '@nestjs/common';
import { DIAN_TAX_CALENDAR_2026_SOURCE_URL } from '../constants/fiscal-tax-calendar-2026';
import { FiscalTaxCalendarService } from './fiscal-tax-calendar.service';

describe('FiscalTaxCalendarService', () => {
  const service = new FiscalTaxCalendarService();
  const nitDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
  // Literal rows transcribed from the DIAN 2026 source, columns NIT digits 1..9,0.
  const monthlyRetentionDaysByPeriod = [
    [10, 11, 12, 13, 16, 17, 18, 19, 20, 23],
    [10, 11, 12, 13, 16, 17, 18, 19, 20, 24],
    [13, 14, 15, 16, 20, 21, 22, 23, 24, 27],
    [12, 13, 14, 15, 19, 20, 21, 22, 25, 26],
    [10, 11, 12, 16, 17, 18, 19, 22, 23, 24],
    [9, 10, 14, 15, 16, 17, 21, 22, 23, 24],
    [12, 13, 14, 18, 19, 20, 21, 24, 25, 26],
    [9, 10, 11, 14, 15, 16, 17, 18, 21, 22],
    [9, 13, 14, 15, 16, 19, 20, 21, 22, 23],
    [11, 12, 13, 17, 18, 19, 20, 23, 24, 25],
    [10, 11, 14, 15, 16, 17, 18, 21, 22, 23],
    [13, 14, 15, 18, 19, 20, 21, 22, 25, 26],
  ];
  const nitForDigit = (digit: number) => `90012345${digit}`;
  const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

  it('matches all official 2026 monthly withholding dates for every NIT digit', () => {
    for (let periodMonth = 1; periodMonth <= 12; periodMonth++) {
      for (const type of ['withholding_return', 'reteiva_return'] as const) {
        for (const [index, nitDigit] of nitDigits.entries()) {
          const result = service.resolve({
            type,
            period_year: 2026,
            period_month: periodMonth,
            periodicity: 'monthly',
            nit: nitForDigit(nitDigit),
            jurisdiction_key: 'CO-DIAN',
          });
          const expectedDay = monthlyRetentionDaysByPeriod[periodMonth - 1][index];
          const dueYear = periodMonth === 12 ? 2027 : 2026;
          const dueMonth = periodMonth === 12 ? 1 : periodMonth + 1;
          expect(result.due_date_verified).toBe(true);
          expect(iso(result.due_date)).toBe(
            `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(expectedDay).padStart(2, '0')}`,
          );
          expect(result.due_date_source).toContain(DIAN_TAX_CALENDAR_2026_SOURCE_URL);
          expect(result.warning).toBeNull();
        }
      }
    }
  });

  it('matches the official bimonthly VAT and INC dates for each closing month and NIT digit', () => {
    for (const [closingMonthText, expectedByNitOrder] of Object.entries({
      2: [10, 11, 12, 13, 16, 17, 18, 19, 20, 24],
      4: [12, 13, 14, 15, 19, 20, 21, 22, 25, 26],
      6: [9, 10, 14, 15, 16, 17, 21, 22, 23, 24],
      8: [9, 10, 11, 14, 15, 16, 17, 18, 21, 22],
      10: [11, 12, 13, 17, 18, 19, 20, 23, 24, 25],
      12: [13, 14, 15, 18, 19, 20, 21, 22, 25, 26],
    })) {
      const closingMonth = Number(closingMonthText);
      for (const [index, nitDigit] of nitDigits.entries()) {
        const expectedDay = expectedByNitOrder[index];
        const result = service.resolve({
          type: 'vat_return',
          period_year: 2026,
          period_month: closingMonth,
          periodicity: 'bimonthly',
          nit: nitForDigit(nitDigit),
          jurisdiction_key: 'CO-DIAN',
        });
        const expectedDueMonth = closingMonth === 12 ? 1 : closingMonth + 1;
        const expectedYear = closingMonth === 12 ? 2027 : 2026;
        expect(iso(result.due_date)).toBe(
          `${expectedYear}-${String(expectedDueMonth).padStart(2, '0')}-${String(expectedDay).padStart(2, '0')}`,
        );
        expect(result.due_date_verified).toBe(true);

        const incResult = service.resolve({
          type: 'inc_return',
          period_year: 2026,
          period_month: closingMonth,
          periodicity: 'bimonthly',
          nit: nitForDigit(nitDigit),
          jurisdiction_key: 'CO-DIAN',
        });
        expect(iso(incResult.due_date)).toBe(iso(result.due_date));
      }
    }
  });

  it('matches all official four-monthly VAT dates for each closing month and NIT digit', () => {
    for (const [closingMonthText, expectedByNitOrder] of Object.entries({
      4: [12, 13, 14, 15, 19, 20, 21, 22, 25, 26],
      8: [9, 10, 11, 14, 15, 16, 17, 18, 21, 22],
      12: [13, 14, 15, 18, 19, 20, 21, 22, 25, 26],
    })) {
      const closingMonth = Number(closingMonthText);
      for (const [index, nitDigit] of nitDigits.entries()) {
        const result = service.resolve({
          type: 'vat_return',
          period_year: 2026,
          period_month: closingMonth,
          periodicity: 'four_monthly',
          nit: nitForDigit(nitDigit),
          jurisdiction_key: 'CO-DIAN',
        });
        const expectedDueMonth = closingMonth === 12 ? 1 : closingMonth + 1;
        const expectedYear = closingMonth === 12 ? 2027 : 2026;
        expect(iso(result.due_date)).toBe(
          `${expectedYear}-${String(expectedDueMonth).padStart(2, '0')}-${String(expectedByNitOrder[index]).padStart(2, '0')}`,
        );
        expect(result.due_date_verified).toBe(true);
      }
    }
  });

  it.each(['900123456', '900123456-7', '900.123.456-9'])(
    'selects the same NIT base digit for plain, undotted-DV, and dotted-DV forms (%s)',
    (nit) => {
      const result = service.resolve({
        type: 'vat_return',
        period_year: 2026,
        period_month: 2,
        periodicity: 'bimonthly',
        nit,
        jurisdiction_key: 'CO-DIAN',
      });
      expect(iso(result.due_date)).toBe('2026-03-17'); // base digit 6, not the DV
    },
  );

  it.each(['900.12-9', '900123456--7', '900123456-77'])(
    'rejects malformed NIT strings instead of guessing a final digit (%s)',
    (nit) => {
      expect(() =>
        service.resolve({
          type: 'vat_return',
          period_year: 2026,
          period_month: 2,
          periodicity: 'bimonthly',
          nit,
          jurisdiction_key: 'CO-DIAN',
        }),
      ).toThrow(BadRequestException);
    },
  );

  it('returns unknown for annual/future calendars and municipal jurisdictions', () => {
    const cases = [
      {
        type: 'income_tax_precierre' as const,
        period_year: 2026,
        period_month: null,
        periodicity: 'annual' as const,
        nit: nitForDigit(1),
        jurisdiction_key: 'CO-DIAN',
      },
      {
        type: 'withholding_return' as const,
        period_year: 2027,
        period_month: 1,
        periodicity: 'monthly' as const,
        nit: nitForDigit(1),
        jurisdiction_key: 'CO-DIAN',
      },
      {
        type: 'ica_return' as const,
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly' as const,
        nit: nitForDigit(1),
        jurisdiction_key: 'CO-11001',
      },
    ];

    for (const input of cases) {
      expect(service.resolve(input)).toMatchObject({
        due_date: null,
        due_date_verified: false,
        due_date_source: null,
        warning: expect.any(String),
      });
    }
  });

  it('returns unknown for explicit SIMPLE/special regimes unless a deadline override is provided', () => {
    const result = service.resolve({
      type: 'vat_return',
      period_year: 2026,
      period_month: 2,
      periodicity: 'bimonthly',
      nit: nitForDigit(1),
      jurisdiction_key: 'CO-DIAN',
      taxpayer_regime: 'Régimen Simple',
    });
    expect(result).toMatchObject({ due_date: null, due_date_verified: false });
    expect(result.warning).toContain('regime');
  });

  it('uses a verified configured override and preserves an unverified flag honestly', () => {
    const verified = service.resolve({
      type: 'ica_return',
      period_year: 2026,
      period_month: 1,
      periodicity: 'monthly',
      nit: nitForDigit(2),
      jurisdiction_key: 'CO-11001',
      configured_deadline_override: {
        date: '2026-02-28',
        source: 'Resolución municipal R-2026',
        verified: true,
      },
    });
    expect(verified).toEqual({
      due_date: new Date('2026-02-28T00:00:00.000Z'),
      due_date_verified: true,
      due_date_source: 'Resolución municipal R-2026',
      warning: null,
    });

    const unverified = service.resolve({
      type: 'ica_return',
      period_year: 2026,
      period_month: 1,
      periodicity: 'monthly',
      nit: nitForDigit(2),
      jurisdiction_key: 'CO-11001',
      taxpayer_regime: 'simple',
      configured_deadline_override: {
        date: '2026-02-28',
        source: 'manual setting awaiting review',
        verified: false,
      },
    });
    expect(unverified.due_date_verified).toBe(false);
    expect(unverified.due_date_source).toBe('manual setting awaiting review');
    expect(unverified.warning).toContain('unverified');
  });

  it.each([
    { date: '2026-02-30', source: 'invalid date', verified: true },
    { date: '2026-02-28', source: '   ', verified: true },
    { date: '2026-02-28', source: 'missing boolean', verified: 'true' },
  ])('rejects malformed configured overrides', (configured_deadline_override) => {
    expect(() =>
      service.resolve({
        type: 'ica_return',
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly',
        nit: nitForDigit(2),
        jurisdiction_key: 'CO-11001',
        configured_deadline_override: configured_deadline_override as any,
      }),
    ).toThrow(BadRequestException);
  });

  it.each([
    { period_year: 2026.5, period_month: 2, periodicity: 'bimonthly' },
    { period_year: 2026, period_month: 0, periodicity: 'bimonthly' },
    { period_year: 2026, period_month: 13, periodicity: 'bimonthly' },
    { period_year: 2026, period_month: 3, periodicity: 'bimonthly' },
    { period_year: 2026, period_month: 6, periodicity: 'four_monthly' },
    { period_year: 2026, period_month: 2, periodicity: 'quarterly' },
  ])('rejects invalid period input %o', (period) => {
    expect(() =>
      service.resolve({
        ...period,
        type: 'vat_return',
        nit: nitForDigit(1),
        jurisdiction_key: 'CO-DIAN',
      } as any),
    ).toThrow(BadRequestException);
  });

  it('returns UTC midnight for December deadlines in January 2027', () => {
    const result = service.resolve({
      type: 'reteiva_return',
      period_year: 2026,
      period_month: 12,
      periodicity: 'monthly',
      nit: nitForDigit(1),
      jurisdiction_key: 'CO-DIAN',
    });
    expect(result.due_date).toEqual(new Date('2027-01-13T00:00:00.000Z'));
  });
});
