import {
  getCancellationBlocker,
  getOrderCancellationPolicy,
  OrderCancellationSnapshot,
  SETTLED_PAYMENT_STATES,
} from './order-cancellation-policy.util';

const STOCK_BLOCKER = 'ORD_CANCEL_STOCK_COMMITTED_001';
const PAYMENT_BLOCKER = 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001';

function snapshot(
  overrides: Partial<OrderCancellationSnapshot> = {},
): OrderCancellationSnapshot {
  return {
    state: 'processing',
    order_items: [{ inventory_committed: false, inventory_consumed_at_fire: false }],
    payments: [],
    ...overrides,
  };
}

function payment(
  state: string,
  processing_mode?: string | null,
  type?: string | null,
): NonNullable<OrderCancellationSnapshot['payments']>[number] {
  return { state, store_payment_method: { system_payment_method: { processing_mode, type } } };
}

describe('Order cancellation policy', () => {
  it('expone el mismo conjunto de pagos liquidados al guard de cancelación de ítem', () => {
    expect([...SETTLED_PAYMENT_STATES].sort()).toEqual([
      'captured', 'partially_refunded', 'refunded', 'succeeded',
    ]);
    expect(SETTLED_PAYMENT_STATES.has('pending')).toBe(false);
  });
  it.each(['draft', 'created', 'pending_payment', 'processing'])(
    'permits cancellation of %s with reservations only',
    (state) => {
      expect(getOrderCancellationPolicy(snapshot({ state }))).toEqual({
        can_cancel: true,
        can_cancel_payment: state !== 'created' && state !== 'draft',
        reason_code: null,
      });
    },
  );

  it.each(['shipped', 'cancelled'])(
    'keeps state eligibility separate from the force-safe blocker: %s',
    (state) => {
      const order = snapshot({ state });
      expect(getCancellationBlocker(order)).toBeNull();
      expect(getOrderCancellationPolicy(order)).toEqual({
        can_cancel: false, can_cancel_payment: false, reason_code: null,
      });
    },
  );

  it('blocks a draft attached to an open table but not a closed one', () => {
    expect(getOrderCancellationPolicy(snapshot({
      state: 'draft', table_sessions: [{ id: 17, closed_at: null }],
    }))).toEqual({
      can_cancel: false, can_cancel_payment: false,
      reason_code: 'ORD_CANCEL_OPEN_TABLE_001',
    });
    expect(getOrderCancellationPolicy(snapshot({
      state: 'draft', table_sessions: [{ id: 17, closed_at: new Date() }],
    })).can_cancel).toBe(true);
  });

  it('a legacy draft with a settled digital payment still requires reversal', () => {
    expect(getOrderCancellationPolicy(snapshot({
      state: 'draft',
      payments: [payment('succeeded', 'ONLINE', 'card')],
    }))).toEqual({
      can_cancel: false,
      can_cancel_payment: false,
      reason_code: PAYMENT_BLOCKER,
    });
  });

  it.each(['delivered', 'finished', 'refunded'])(
    'blocks forced cancellation from %s even without line snapshots',
    (state) => expect(getCancellationBlocker(snapshot({ state }))).toBe(STOCK_BLOCKER),
  );

  it('blocks legacy unpaid pending stock without claiming it was physically returned', () => {
    expect(getOrderCancellationPolicy(snapshot({
      state: 'pending_payment',
      order_items: [{ inventory_committed: true }],
      payments: [payment('pending', 'ONLINE', 'wompi')],
    }))).toEqual({ can_cancel: false, can_cancel_payment: false, reason_code: STOCK_BLOCKER });
  });

  it('gives inventory precedence over a confirmed digital payment', () => {
    expect(getCancellationBlocker(snapshot({
      order_items: [{ inventory_committed: true }],
      payments: [payment('succeeded', 'ONLINE', 'wompi')],
    }))).toBe(STOCK_BLOCKER);
  });

  it.each(['2026-09-20T00:00:00Z', new Date('2026-09-20T00:00:00Z')])(
    'blocks line delivery evidence even when inventory was not committed: %s',
    (delivered_at) => expect(getCancellationBlocker(snapshot({
      order_items: [{ delivered_at }],
    }))).toBe(STOCK_BLOCKER),
  );

  it('recognizes order delivery metadata persisted outside the state column', () => {
    expect(getCancellationBlocker(snapshot({
      internal_notes: JSON.stringify({ _flow_metadata: { delivered_at: '2026-09-20T00:00:00Z' } }),
    }))).toBe(STOCK_BLOCKER);
  });

  it.each(['plain text', '{malformed', 'null', '{}'])(
    'does not invent delivery from legacy notes: %s',
    (internal_notes) => expect(getCancellationBlocker(snapshot({ internal_notes }))).toBeNull(),
  );

  it('leaves fired kitchen lines to the existing reuse/waste lifecycle', () => {
    expect(getCancellationBlocker(snapshot({
      order_items: [{
        inventory_consumed_at_fire: true,
        inventory_committed: true,
        delivered_at: '2026-09-20T00:00:00Z',
      }],
      payments: [payment('succeeded', 'DIRECT', 'cash')],
    }))).toBeNull();
  });

  it('does not let a kitchen line hide committed retail stock in a mixed order', () => {
    expect(getCancellationBlocker(snapshot({ order_items: [
      { inventory_consumed_at_fire: true },
      { inventory_committed: true, inventory_consumed_at_fire: false },
    ] }))).toBe(STOCK_BLOCKER);
  });

  it.each(['succeeded', 'captured', 'partially_refunded', 'refunded'])(
    'requires processor reversal for %s ONLINE even without committed stock',
    (state) => expect(getOrderCancellationPolicy(snapshot({
      payments: [payment(state, 'ONLINE', 'card')],
    }))).toEqual({ can_cancel: false, can_cancel_payment: false, reason_code: PAYMENT_BLOCKER }),
  );

  it.each(['wompi', 'wallet'])(
    'recognizes legacy deferred type %s without processing_mode',
    (type) => expect(getCancellationBlocker(snapshot({
      payments: [payment('succeeded', undefined, type)],
    }))).toBe(PAYMENT_BLOCKER),
  );

  it('does not trust a DIRECT flag on a legacy Wompi method', () => {
    expect(getCancellationBlocker(snapshot({
      payments: [payment('succeeded', 'DIRECT', 'wompi')],
    }))).toBe(PAYMENT_BLOCKER);
  });

  it.each(['cash', 'card', 'bank_transfer', 'cash_on_delivery'])(
    'preserves known direct settled method %s with no delivery',
    (type) => expect(getOrderCancellationPolicy(snapshot({
      payments: [payment('succeeded', undefined, type)],
    }))).toEqual({ can_cancel: true, can_cancel_payment: true, reason_code: null }),
  );

  it.each(['DIRECT', 'ON_DELIVERY'])(
    'uses explicit processing_mode %s for current methods',
    (mode) => expect(getCancellationBlocker(snapshot({
      payments: [payment('succeeded', mode, 'custom')],
    }))).toBeNull(),
  );

  it.each(['pending', 'failed', 'cancelled', 'authorized'])(
    'does not mistake uncollected payment state %s for captured money',
    (state) => expect(getCancellationBlocker(snapshot({
      payments: [payment(state, 'ONLINE', 'wompi')],
    }))).toBeNull(),
  );

  it.each([
    { state: 'succeeded' },
    { state: 'succeeded', store_payment_method: null },
    { state: 'captured', store_payment_method: { system_payment_method: null } },
    payment('succeeded', undefined, undefined),
    payment('succeeded', undefined, 'unknown'),
  ])('fails closed for a settled payment with missing/unknown method: %j', (row) => {
    expect(getCancellationBlocker(snapshot({ payments: [row] }))).toBe(PAYMENT_BLOCKER);
  });

  it('does not mutate the snapshot or use a cash payment to hide a second online charge', () => {
    const order = snapshot({ payments: [
      payment('succeeded', 'DIRECT', 'cash'),
      payment('succeeded', 'ONLINE', 'wompi'),
    ] });
    const before = JSON.stringify(order);
    expect(getCancellationBlocker(order)).toBe(PAYMENT_BLOCKER);
    expect(JSON.stringify(order)).toBe(before);
  });

  describe('B4 (release-855) — delivered/finished payment-only cancellation', () => {
    it.each(['delivered', 'finished'])(
      'allows can_cancel_payment on %s with a settled direct payment, stock blocker aside',
      (state) => {
        const policy = getOrderCancellationPolicy(snapshot({
          state,
          payments: [payment('succeeded', 'DIRECT', 'cash')],
        }));
        expect(policy.can_cancel).toBe(false);
        expect(policy.reason_code).toBe(STOCK_BLOCKER);
        expect(policy.can_cancel_payment).toBe(true);
      },
    );

    it.each(['delivered', 'finished'])(
      'keeps can_cancel_payment false on %s when the settled payment is non-direct',
      (state) => expect(getOrderCancellationPolicy(snapshot({
        state,
        payments: [payment('succeeded', 'ONLINE', 'wompi')],
      })).can_cancel_payment).toBe(false),
    );

    it.each(['delivered', 'finished'])(
      'keeps can_cancel_payment false on %s with no settled payment at all',
      (state) => expect(getOrderCancellationPolicy(snapshot({
        state,
        payments: [payment('pending', 'DIRECT', 'cash')],
      })).can_cancel_payment).toBe(false),
    );

    it('does not extend the delivered/finished carve-out to refunded orders', () => {
      expect(getOrderCancellationPolicy(snapshot({
        state: 'refunded',
        payments: [payment('succeeded', 'DIRECT', 'cash')],
      })).can_cancel_payment).toBe(false);
    });
  });
});
