import {
  buildRouteReconciliation,
  ReconciliationStopInput,
} from './route-stop-calc';

describe('buildRouteReconciliation (pure COD reconciliation summary)', () => {
  const stop = (
    overrides: Partial<ReconciliationStopInput> = {},
  ): ReconciliationStopInput => ({
    stop_sequence: 1,
    dispatch_note_id: 900,
    is_prepaid: false,
    result: null,
    collected_amount: 0,
    anticipo_amount: 0,
    dispatch_note_grand_total: 100,
    ...overrides,
  });

  it('projects totals for an OPEN route from live stops', () => {
    const r = buildRouteReconciliation(
      [
        stop({ stop_sequence: 1, dispatch_note_id: 900, dispatch_note_grand_total: 200, collected_amount: 200, result: 'delivered' }),
        stop({ stop_sequence: 2, dispatch_note_id: 901, dispatch_note_grand_total: 150, collected_amount: 100, anticipo_amount: 0, result: 'partial' }),
        stop({ stop_sequence: 3, dispatch_note_id: 902, dispatch_note_grand_total: 80, is_prepaid: true, result: 'delivered' }),
      ],
      { is_closed: false },
    );

    expect(r.total_to_collect).toBe(350); // 200 + 150 (prepaid 80 excluded)
    expect(r.total_collected).toBe(300); // 200 + 100
    expect(r.total_prepaid).toBe(80);
    expect(r.variance).toBe(-50); // 300 - 350 → faltante
    expect(r.is_closed).toBe(false);
    expect(r.by_stop).toHaveLength(3);
  });

  it('counts anticipo into collected and zeroes expected for prepaid stops', () => {
    const r = buildRouteReconciliation(
      [
        stop({ collected_amount: 60, anticipo_amount: 40, dispatch_note_grand_total: 100, result: 'delivered' }),
        stop({ stop_sequence: 2, dispatch_note_id: 901, is_prepaid: true, dispatch_note_grand_total: 500 }),
      ],
      { is_closed: false },
    );

    const cod = r.by_stop.find((s) => s.stop_sequence === 1)!;
    const prepaid = r.by_stop.find((s) => s.stop_sequence === 2)!;
    expect(cod.collected).toBe(100);
    expect(cod.expected).toBe(100);
    expect(prepaid.expected).toBe(0);
    expect(prepaid.is_prepaid).toBe(true);
  });

  it('computes pending_collection only for non-settled non-prepaid stops', () => {
    const r = buildRouteReconciliation(
      [
        // settled, fully collected → no pending
        stop({ stop_sequence: 1, collected_amount: 100, result: 'delivered' }),
        // not yet settled, nothing collected → pending 150
        stop({ stop_sequence: 2, dispatch_note_id: 901, dispatch_note_grand_total: 150, result: null }),
        // settled-partial → settled, excluded from pending even if short
        stop({ stop_sequence: 3, dispatch_note_id: 902, dispatch_note_grand_total: 200, collected_amount: 50, result: 'partial' }),
      ],
      { is_closed: false },
    );

    expect(r.pending_collection).toBe(150);
  });

  it('reuses persisted close totals when the route is CLOSED', () => {
    const r = buildRouteReconciliation(
      [
        stop({ collected_amount: 999, dispatch_note_grand_total: 100, result: 'delivered' }),
      ],
      {
        is_closed: true,
        persisted: { total_collected: 95, cash_variance: -5 },
      },
    );

    // Persisted wins over the projected 999.
    expect(r.total_collected).toBe(95);
    expect(r.variance).toBe(-5);
    expect(r.is_closed).toBe(true);
  });

  it('falls back to projection when closed but persisted totals are absent', () => {
    const r = buildRouteReconciliation(
      [stop({ collected_amount: 100, dispatch_note_grand_total: 100, result: 'delivered' })],
      { is_closed: true, persisted: null },
    );

    expect(r.total_collected).toBe(100);
    expect(r.variance).toBe(0);
  });

  it('marks released and rejected stops as settled', () => {
    const r = buildRouteReconciliation(
      [
        stop({ stop_sequence: 1, result: 'released' }),
        stop({ stop_sequence: 2, dispatch_note_id: 901, result: 'rejected' }),
        stop({ stop_sequence: 3, dispatch_note_id: 902, result: null }),
      ],
      { is_closed: false },
    );

    expect(r.by_stop.find((s) => s.stop_sequence === 1)!.settled).toBe(true);
    expect(r.by_stop.find((s) => s.stop_sequence === 2)!.settled).toBe(true);
    expect(r.by_stop.find((s) => s.stop_sequence === 3)!.settled).toBe(false);
  });
});
