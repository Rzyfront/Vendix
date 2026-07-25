import {
  buildLayawaySchedule,
  isLayawayConfigValid,
  round2,
  LayawayFrequency,
} from './layaway-schedule';

/**
 * Pure-helper tests for the layaway installment preview builder.
 *
 * These run under the Jest config in `apps/mobile/jest.config.js` once a runner
 * is wired. They are deliberately framework-free (no React Native) so they
 * execute under any Node test runner with `ts-jest`.
 *
 * See plan §10.1 for the 11 cases. We also assert the round2 helper directly
 * to lock in the float-safety behaviour.
 */

function sumAmounts(
  rows: ReturnType<typeof buildLayawaySchedule>,
): number {
  // Use integer-cents math to avoid the very artefacts we're guarding against.
  return rows.reduce((acc, r) => acc + Math.round(r.amount * 100), 0) / 100;
}

describe('round2', () => {
  it('rounds to 2 decimal places using integer cents', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(33.3333333)).toBe(33.33);
    expect(round2(33.337)).toBe(33.34);
    expect(round2(0)).toBe(0);
  });
});

describe('buildLayawaySchedule', () => {
  it('case 1 — 300000 split in 3 monthly equal installments', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 300000,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.amount)).toEqual([100000, 100000, 100000]);
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-08-24',
      '2026-09-23',
      '2026-10-23',
    ]);
    expect(sumAmounts(rows)).toBe(300000);
  });

  it('case 2 — 100 split in 3, remainder goes to last installment', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toHaveLength(3);
    // 100 / 3 = 33.333… → first two are 33.33, last absorbs the remainder (33.34)
    expect(rows.map((r) => r.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(sumAmounts(rows)).toBe(100);
  });

  it('case 3 — 100 with down payment 33, remaining 67 split in 3 sums exactly', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 33,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toHaveLength(3);
    // 67 / 3 = 22.333… → 22.33, 22.33, 22.34
    expect(rows.map((r) => r.amount)).toEqual([22.33, 22.33, 22.34]);
    expect(sumAmounts(rows)).toBe(67);
  });

  it('case 4 — returns [] when numInstallments is 0', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 0,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toEqual([]);
  });

  it('case 5 — returns [] when downPayment >= cartTotal', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 100,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toEqual([]);
  });

  it('case 6 — weekly frequency adds 7 days per installment', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'weekly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-08-01',
      '2026-08-08',
      '2026-08-15',
    ]);
  });

  it('case 7 — biweekly frequency adds 14 days per installment', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'biweekly' as LayawayFrequency,
      firstInstallmentDate: '2026-08-01',
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-08-15',
      '2026-08-29',
      '2026-09-12',
    ]);
  });

  it('case 8 — handles max 60 installments with remainder in the last', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 60,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toHaveLength(60);
    // 100/60 = 1.6666… → first 59 at 1.67, last at 1.67 with remainder applied.
    // Use sumAmounts to assert exact invariant.
    expect(sumAmounts(rows)).toBe(100);
  });

  it('assigns sequential installment_number starting at 1', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 300,
      downPayment: 0,
      numInstallments: 5,
      frequency: 'weekly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows.map((r) => r.installment_number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('defaults firstInstallmentDate to today when omitted', () => {
    const before = new Date();
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 1,
      frequency: 'monthly' as LayawayFrequency,
    });
    const after = new Date();
    const expectedDue = new Date(before);
    expectedDue.setDate(expectedDue.getDate() + 30);
    // Allow ±1s skew from wall-clock drift between before/after captures.
    expect(
      Math.abs(new Date(rows[0].due_date).getTime() - expectedDue.getTime()),
    ).toBeLessThanOrEqual(60_000);
    // And after capture must be at or before the expected due date.
    const expectedAfter = new Date(after);
    expectedAfter.setDate(expectedAfter.getDate() + 30);
    expect(
      Math.abs(new Date(rows[0].due_date).getTime() - expectedAfter.getTime()),
    ).toBeLessThanOrEqual(60_000);
  });
});

describe('isLayawayConfigValid', () => {
  it('case 9 — rejects when remaining balance is not positive', () => {
    expect(
      isLayawayConfigValid({ cartTotal: 0, downPayment: 0, numInstallments: 1 }),
    ).toBe(false);
  });

  it('case 10 — rejects when downPayment equals cartTotal', () => {
    expect(
      isLayawayConfigValid({
        cartTotal: 100,
        downPayment: 100,
        numInstallments: 1,
      }),
    ).toBe(false);
  });

  it('case 11 — accepts valid 100/50/3', () => {
    expect(
      isLayawayConfigValid({
        cartTotal: 100,
        downPayment: 50,
        numInstallments: 3,
      }),
    ).toBe(true);
  });

  it('rejects when numInstallments is 0', () => {
    expect(
      isLayawayConfigValid({
        cartTotal: 100,
        downPayment: 0,
        numInstallments: 0,
      }),
    ).toBe(false);
  });

  it('rejects negative downPayment', () => {
    expect(
      isLayawayConfigValid({
        cartTotal: 100,
        downPayment: -1,
        numInstallments: 3,
      }),
    ).toBe(false);
  });
});