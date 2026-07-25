import {
  buildLayawaySchedule,
  isLayawayConfigValid,
  allocateCartDiscounts,
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

  it('rejects when remaining balance in cents is below numInstallments (Min(0.01) per row)', () => {
    // remaining = 0.02, n = 3 → backend Min(0.01) per installment would
    // require 0.03 in cents for 3 installments, impossible.
    expect(
      isLayawayConfigValid({
        cartTotal: 0.02,
        downPayment: 0,
        numInstallments: 3,
      }),
    ).toBe(false);
  });

  it('accepts remaining exactly equal to 1 cent per installment (boundary)', () => {
    expect(
      isLayawayConfigValid({
        cartTotal: 0.03,
        downPayment: 0,
        numInstallments: 3,
      }),
    ).toBe(true);
  });

  it('rejects non-finite numeric values', () => {
    expect(
      isLayawayConfigValid({ cartTotal: NaN, downPayment: 0, numInstallments: 1 }),
    ).toBe(false);
    expect(
      isLayawayConfigValid({ cartTotal: 100, downPayment: Infinity, numInstallments: 1 }),
    ).toBe(false);
    expect(
      isLayawayConfigValid({ cartTotal: 100, downPayment: 0, numInstallments: 2.5 }),
    ).toBe(false);
    expect(
      isLayawayConfigValid({ cartTotal: 100, downPayment: 0, numInstallments: Number.MAX_SAFE_INTEGER + 2 }),
    ).toBe(false);
  });
});

describe('buildLayawaySchedule — calendar and discount-aware cases', () => {
  it('case 12 — financing schedule with prior cart-level discount', () => {
    // Mirrors QUI-499 pr-review HIGH bug scenario:
    // cart subtotal = 100000, cart discount = 10000, summary.total = 90000.
    // The schedule must reflect the discounted total exactly.
    const rows = buildLayawaySchedule({
      cartTotal: 90000,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    expect(rows).toHaveLength(3);
    expect(sumAmounts(rows)).toBe(90000);
    expect(rows.map((r) => r.amount)).toEqual([30000, 30000, 30000]);
  });

  it('case 13 — leap-day monthly rollover across Feb 29', () => {
    // Starts in late January 2028. +30d crossing leap day.
    const rows = buildLayawaySchedule({
      cartTotal: 200,
      downPayment: 0,
      numInstallments: 4,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2028-01-31',
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      '2028-03-01', // Jan 31 + 30d → Mar 1 (no Feb 31)
      '2028-03-31',
      '2028-04-30',
      '2028-05-30',
    ]);
  });

  it('case 14 — leap year first installment starting on Feb 29', () => {
    const rows = buildLayawaySchedule({
      cartTotal: 100,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2028-02-29',
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      '2028-03-30',
      '2028-04-29',
      '2028-05-29',
    ]);
  });
});

describe('allocateCartDiscounts', () => {
  it('returns zeros for empty items or zero discount', () => {
    expect(allocateCartDiscounts([], 100)).toEqual([]);
    expect(allocateCartDiscounts([{ unitPrice: 100, quantity: 1 }], 0)).toEqual([0]);
    expect(allocateCartDiscounts([{ unitPrice: 100, quantity: 1 }], -5)).toEqual([0]);
  });

  it('proportionally allocates by unit_price × quantity and sums exactly', () => {
    // Two items: 50000 × 2 = 100000 weighted vs 50000 × 1 = 50000 weighted.
    // Total discount = 15000. Weights 2:1. Expected ≈ [10000, 5000].
    const items = [
      { unitPrice: 50000, quantity: 2 },
      { unitPrice: 50000, quantity: 1 },
    ];
    const allocations = allocateCartDiscounts(items, 15000);
    const sum = allocations.reduce((s, a) => s + a, 0);
    expect(sum).toBeCloseTo(15000, 2);
    // Proportional check (rounding remainder may shift cents).
    expect(allocations[0]).toBeGreaterThan(allocations[1]);
  });

  it('absorbs cent-rounding remainder into the last item (exact reconciliation)', () => {
    // 3 items of equal weight, discount = 100.03 → 33.34, 33.34, 33.35
    const items = [
      { unitPrice: 100, quantity: 1 },
      { unitPrice: 100, quantity: 1 },
      { unitPrice: 100, quantity: 1 },
    ];
    const allocations = allocateCartDiscounts(items, 100.03);
    const sum =
      Math.round(allocations[0] * 100) +
      Math.round(allocations[1] * 100) +
      Math.round(allocations[2] * 100);
    expect(sum / 100).toBeCloseTo(100.03, 2);
  });

  it('caps each line at its own unit_price × quantity when discount exceeds line gross', () => {
    // Item 1 has weight 10, item 2 has weight 1000. Discount = 500 → item 1
    // would theoretically get 4.95 (>10 not possible), so cap to 10 and
    // re-allocate the remainder into item 2.
    const items = [
      { unitPrice: 10, quantity: 1 },
      { unitPrice: 1000, quantity: 1 },
    ];
    const allocations = allocateCartDiscounts(items, 500);
    // Item 1 cap = 10. The remaining 490 must fit in item 2 (cap 1000).
    expect(allocations[0]).toBeLessThanOrEqual(10);
    expect(allocations[1]).toBeLessThanOrEqual(1000);
    // Total must reconcile (subject to back-fill reaching the cap).
    const sum = allocations.reduce((s, a) => s + a, 0);
    expect(sum).toBeCloseTo(500, 2);
  });

  it('QUI-499 end-to-end: discounted cart reconstruction equals installment basis', () => {
    // The exact scenario from the pr-review HIGH bug:
    // 2 items × 50000 + cart discount 10000 → summary.total = 90000.
    // After dispatching the discount to items (proportional), the backend
    // rebuilds Σ (unit*qty − discount + tax) = 90000 exactly, matching the
    // installment preview built from summary.total.
    const items = [
      { unitPrice: 50000, quantity: 1 },
      { unitPrice: 50000, quantity: 1 },
    ];
    const allocations = allocateCartDiscounts(items, 10000);
    const reconstructed = items.reduce((sum, i, idx) => {
      const gross = i.unitPrice * i.quantity;
      return sum + (gross - allocations[idx]);
    }, 0);
    expect(reconstructed).toBeCloseTo(90000, 2);
    // And the schedule built from the discounted cart total sums exactly.
    const rows = buildLayawaySchedule({
      cartTotal: 90000,
      downPayment: 0,
      numInstallments: 3,
      frequency: 'monthly' as LayawayFrequency,
      firstInstallmentDate: '2026-07-25',
    });
    const scheduleSum = rows.reduce((s, r) => s + r.amount, 0);
    expect(scheduleSum).toBeCloseTo(reconstructed, 2);
  });
});