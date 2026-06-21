import {
  aggregateRouteTotals,
  buildRouteReconciliation,
  buildStopsData,
  computeRouteTotals,
  resolveIsPrepaid,
} from './route-stop-calc';

describe('resolveIsPrepaid (safe default = COD)', () => {
  it('returns false when needs_collection is explicitly true (COD wins over invoice)', () => {
    expect(
      resolveIsPrepaid({
        needs_collection: true,
        invoice: { payment_date: new Date() },
      }),
    ).toBe(false);
  });

  it('returns true when invoice has payment_date (legacy fallback)', () => {
    expect(
      resolveIsPrepaid({
        needs_collection: null,
        invoice: { payment_date: new Date() },
      }),
    ).toBe(true);
  });

  it('returns false when needs_collection is null and no invoice (safe default)', () => {
    expect(resolveIsPrepaid({ needs_collection: null })).toBe(false);
    expect(resolveIsPrepaid({})).toBe(false);
    expect(resolveIsPrepaid({ invoice: null })).toBe(false);
  });

  it('treats explicit needs_collection=false as COD (does NOT mark as prepaid)', () => {
    // Regression: previous bug marked a note with explicit `false` as prepaid
    // if there was no paid invoice. The fix requires a paid invoice to mark
    // a note as prepaid.
    expect(resolveIsPrepaid({ needs_collection: false })).toBe(false);
  });

  it('returns false when invoice exists but has no payment_date', () => {
    expect(
      resolveIsPrepaid({ needs_collection: null, invoice: { payment_date: null } }),
    ).toBe(false);
  });
});

describe('aggregateRouteTotals (live route aggregates)', () => {
  it('sums only non-prepaid stops into total_collected and total_to_collect', () => {
    const totals = aggregateRouteTotals([
      { is_prepaid: false, dispatch_note_grand_total: 100, collected_amount: 100 },
      { is_prepaid: false, dispatch_note_grand_total: 200, collected_amount: 50 },
      { is_prepaid: true, dispatch_note_grand_total: 500 },
    ]);
    expect(totals.total_collected).toBe(150);
    expect(totals.total_to_collect).toBe(300);
    expect(totals.total_prepaid).toBe(500);
    expect(totals.total_credit).toBe(0);
    expect(totals.total_withholdings).toBe(0);
    expect(totals.total_changes).toBe(0);
  });

  it('counts anticipo into collected and handles string decimals', () => {
    const totals = aggregateRouteTotals([
      {
        is_prepaid: false,
        dispatch_note_grand_total: '100.50',
        collected_amount: '60.25',
        anticipo_amount: '40.25',
      },
    ]);
    expect(totals.total_collected).toBe(100.5);
    expect(totals.total_to_collect).toBe(100.5);
  });

  it('returns zeros for an empty stop list', () => {
    const totals = aggregateRouteTotals([]);
    expect(totals).toEqual({
      total_collected: 0,
      total_changes: 0,
      total_withholdings: 0,
      total_credit: 0,
      total_prepaid: 0,
      total_to_collect: 0,
    });
  });

  it('sums withholdings, changes, and credit from non-prepaid stops only', () => {
    const totals = aggregateRouteTotals([
      {
        is_prepaid: false,
        dispatch_note_grand_total: 1000,
        collected_amount: 800,
        withholding_amount: 100,
        change_amount: 50,
        credit_amount: 50,
      },
      // The prepaid stop should NOT contribute to withholdings/changes/credit.
      {
        is_prepaid: true,
        dispatch_note_grand_total: 999,
        collected_amount: 0,
        withholding_amount: 999,
        change_amount: 999,
        credit_amount: 999,
      },
    ]);
    expect(totals.total_withholdings).toBe(100);
    expect(totals.total_changes).toBe(50);
    expect(totals.total_credit).toBe(50);
  });
});

describe('buildStopsData (safe defaults)', () => {
  const notes = new Map([
    [10, { id: 10, grand_total: 100, needs_collection: true, invoice: null }],
    [
      11,
      {
        id: 11,
        grand_total: 200,
        needs_collection: null,
        invoice: { payment_date: new Date() },
      },
    ],
    [12, { id: 12, grand_total: 300, needs_collection: null, invoice: null }],
  ]);

  it('marks COD note (needs_collection=true) as not prepaid', () => {
    const [stop] = buildStopsData([{ dispatch_note_id: 10 }], notes);
    expect(stop.is_prepaid).toBe(false);
  });

  it('marks note with paid invoice as prepaid', () => {
    const [stop] = buildStopsData([{ dispatch_note_id: 11 }], notes);
    expect(stop.is_prepaid).toBe(true);
  });

  it('marks note without invoice and no explicit needs_collection as COD (safe default)', () => {
    const [stop] = buildStopsData([{ dispatch_note_id: 12 }], notes);
    expect(stop.is_prepaid).toBe(false);
  });
});

describe('computeRouteTotals + buildRouteReconciliation consistency', () => {
  const notes = new Map([
    [1, { id: 1, grand_total: 100, needs_collection: true, invoice: null }],
    [2, { id: 2, grand_total: 200, needs_collection: true, invoice: null }],
    [3, { id: 3, grand_total: 500, needs_collection: null, invoice: { payment_date: new Date() } }],
  ]);

  const stops = buildStopsData(
    [
      { dispatch_note_id: 1, stop_sequence: 1 },
      { dispatch_note_id: 2, stop_sequence: 2 },
      { dispatch_note_id: 3, stop_sequence: 3 },
    ],
    notes,
  );

  it('matches close-time totals with the same logic', () => {
    const { total_to_collect, total_prepaid } = computeRouteTotals(stops, notes);
    expect(total_to_collect).toBe(300);
    expect(total_prepaid).toBe(500);
  });

  it('reconciliation by_stop mirrors stop is_prepaid and grand_total', () => {
    const r = buildRouteReconciliation(
      stops.map((s, i) => ({
        stop_sequence: i + 1,
        dispatch_note_id: s.dispatch_note_id,
        is_prepaid: s.is_prepaid,
        result: null,
        collected_amount: s.collected_amount,
        anticipo_amount: s.anticipo_amount,
        dispatch_note_grand_total: notes.get(s.dispatch_note_id)?.grand_total,
      })),
      { is_closed: false },
    );
    expect(r.by_stop).toHaveLength(3);
    expect(r.by_stop[0].is_prepaid).toBe(false);
    expect(r.by_stop[2].is_prepaid).toBe(true);
    expect(r.by_stop[2].expected).toBe(0);
  });
});
