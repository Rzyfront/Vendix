import {
  canPay,
  canCancelPayment,
  canCancelPaymentAsRole,
  canRefund,
  canCancel,
  canAssignShipping,
  canConfirmDelivery,
  canEditOrder,
  canReactivate,
  canFastTrack,
  canCreditPayment,
  canDispatchOrder,
  canManualShip,
  canReadyForPickupBeforePayment,
  canDirectDeliver,
  canDeliverItem,
  canCancelItem,
  canReverseDeliveredItem,
  canResendItem,
  computeItemActions,
  computeOrderActions,
  REFUNDABLE_ORDER_STATES,
  OrderActionSnapshot,
  OrderItemActionSnapshot,
} from './order-action-policy.util';

const ALREADY_PAID = 'ORD_PAY_ALREADY_PAID_001';
const CANCEL_FINISHED = 'ORD_PAYMENT_CANCEL_FINISHED_001';
const REVERSAL_REQUIRED = 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001';
const INVOICED = 'ORD_PAYMENT_CANCEL_INVOICED_001';
const SPLIT_LOCKED = 'SPLIT_ACCOUNT_LOCKED';
const ITEM_NOT_DELIVERABLE = 'ORDER_ITEM_NOT_DELIVERABLE';

function order(overrides: Partial<OrderActionSnapshot> = {}): OrderActionSnapshot {
  return {
    state: 'created',
    grand_total: 100,
    payments: [],
    refunds: [],
    order_items: [{ inventory_committed: false, inventory_consumed_at_fire: false }],
    ...overrides,
  };
}

function directPayment(amount: number): NonNullable<OrderActionSnapshot['payments']>[number] {
  return {
    state: 'succeeded',
    amount,
    store_payment_method: { system_payment_method: { processing_mode: 'DIRECT', type: 'cash' } },
  };
}

function gatewayPayment(amount: number): NonNullable<OrderActionSnapshot['payments']>[number] {
  return {
    state: 'succeeded',
    amount,
    store_payment_method: { system_payment_method: { processing_mode: 'ONLINE', type: 'wompi' } },
  };
}

describe('order-action-policy — canPay (B1b)', () => {
  it.each(['draft', 'created', 'pending_payment', 'shipped', 'delivered', 'finished'])(
    'enables pay on unpaid %s',
    (state) => {
      expect(canPay(order({ state, payments: [] }))).toEqual({ enabled: true });
    },
  );

  it.each(['processing', 'cancelled', 'refunded'])(
    'disables pay outside the payable state set: %s',
    (state) => expect(canPay(order({ state })).enabled).toBe(false),
  );

  it('rejects a fully-settled order with ORD_PAY_ALREADY_PAID_001', () => {
    const result = canPay(order({ state: 'shipped', payments: [directPayment(100)] }));
    expect(result).toEqual({ enabled: false, reason: ALREADY_PAID });
  });

  it('an active financial split locks pay even when unpaid', () => {
    const result = canPay(order({ state: 'created', active_financial_split_id: 42 }));
    expect(result).toEqual({ enabled: false, reason: SPLIT_LOCKED });
  });

  it('the split lock takes precedence over the already-paid check', () => {
    const result = canPay(
      order({ state: 'shipped', active_financial_split_id: 42, payments: [directPayment(100)] }),
    );
    expect(result.reason).toBe(SPLIT_LOCKED);
  });

  it('pay stays enabled on delivered when not yet fully settled (settles money only, does not finalize)', () => {
    expect(canPay(order({ state: 'delivered', grand_total: 100, payments: [directPayment(40)] }))).toEqual({
      enabled: true,
    });
  });
});

describe('order-action-policy — canCancelPayment (B4/B1b)', () => {
  it('hard-rejects finished — use a refund instead', () => {
    expect(canCancelPayment(order({ state: 'finished', payments: [directPayment(100)] }))).toEqual({
      enabled: false,
      reason: CANCEL_FINISHED,
    });
  });

  it('an active financial split locks cancel_payment even on an otherwise-eligible state', () => {
    expect(
      canCancelPayment(
        order({ state: 'shipped', active_financial_split_id: 7, payments: [directPayment(100)] }),
      ),
    ).toEqual({ enabled: false, reason: SPLIT_LOCKED });
  });

  it.each(['shipped', 'delivered'])(
    'enables a DIRECT settled payment reversal on %s with no invoice issued',
    (state) => {
      expect(canCancelPayment(order({ state, payments: [directPayment(100)] }))).toEqual({
        enabled: true,
      });
    },
  );

  it.each(['shipped', 'delivered'])(
    'requires a gateway reversal instead on %s for a non-direct settled payment',
    (state) => {
      expect(canCancelPayment(order({ state, payments: [gatewayPayment(100)] }))).toEqual({
        enabled: false,
        reason: REVERSAL_REQUIRED,
      });
    },
  );

  it.each(['shipped', 'delivered'])(
    'rejects on %s once a sales invoice has already been issued',
    (state) => {
      expect(
        canCancelPayment(
          order({ state, payments: [directPayment(100)], hasIssuedSalesInvoice: true }),
        ),
      ).toEqual({ enabled: false, reason: INVOICED });
    },
  );

  it.each(['shipped', 'delivered'])(
    'disables on %s with no settled payment at all',
    (state) => expect(canCancelPayment(order({ state, payments: [] })).enabled).toBe(false),
  );

  it.each(['pending_payment', 'processing'])(
    'delegates to the cancellation policy on %s (reservations only, no blockers)',
    (state) => {
      expect(canCancelPayment(order({ state, payments: [] }))).toEqual({ enabled: true });
    },
  );

  it.each(['draft', 'created', 'cancelled', 'refunded'])(
    'disables cancel_payment on %s (not a payment-cancelable state)',
    (state) => expect(canCancelPayment(order({ state })).enabled).toBe(false),
  );
});

describe('order-action-policy — canCancelPaymentAsRole', () => {
  const eligible = order({ state: 'shipped', payments: [directPayment(100)] });

  it('permits owner/admin (case-insensitive)', () => {
    expect(canCancelPaymentAsRole(eligible, { roles: ['OWNER'] })).toEqual({ enabled: true });
    expect(canCancelPaymentAsRole(eligible, { roles: ['admin'] })).toEqual({ enabled: true });
  });

  it('forbids a non owner/admin role regardless of state eligibility', () => {
    expect(canCancelPaymentAsRole(eligible, { roles: ['cashier'] })).toEqual({
      enabled: false,
      reason: 'FORBIDDEN',
    });
  });

  it('stays permissive (delegates to the state/payment predicate) when roles are not resolved', () => {
    expect(canCancelPaymentAsRole(eligible, {})).toEqual({ enabled: true });
  });
});

describe('order-action-policy — canRefund', () => {
  it('exposes the exact refundable-state list refund-flow.service.ts reuses', () => {
    expect([...REFUNDABLE_ORDER_STATES].sort()).toEqual(['delivered', 'finished']);
  });

  it.each(['delivered', 'finished'])('enables refund on %s', (state) =>
    expect(canRefund(order({ state }))).toEqual({ enabled: true }),
  );

  it.each(['draft', 'created', 'pending_payment', 'processing', 'shipped', 'cancelled', 'refunded'])(
    'disables refund on %s',
    (state) => expect(canRefund(order({ state })).enabled).toBe(false),
  );
});

describe('order-action-policy — canCancel', () => {
  it.each(['draft', 'created', 'pending_payment', 'processing'])(
    'enables cancel on %s with no blockers',
    (state) => expect(canCancel(order({ state }))).toEqual({ enabled: true }),
  );

  it.each(['delivered', 'finished', 'refunded'])(
    'disables forced cancellation on %s (stock/delivery blocker)',
    (state) =>
      expect(canCancel(order({ state }))).toEqual({
        enabled: false,
        reason: 'ORD_CANCEL_STOCK_COMMITTED_001',
      }),
  );
});

describe('order-action-policy — canAssignShipping', () => {
  it('enables when no method is assigned and it is not a direct-delivery order', () => {
    expect(canAssignShipping(order({ shipping_method_id: null, delivery_type: 'shipping' }))).toEqual({
      enabled: true,
    });
  });

  it('disables once a method is already assigned', () => {
    expect(canAssignShipping(order({ shipping_method_id: 5, delivery_type: 'shipping' })).enabled).toBe(
      false,
    );
  });

  it('disables for direct_delivery even with no method assigned', () => {
    expect(
      canAssignShipping(order({ shipping_method_id: null, delivery_type: 'direct_delivery' })).enabled,
    ).toBe(false);
  });
});

describe('order-action-policy — canConfirmDelivery', () => {
  it.each(['delivered', 'processing'])('enables on %s with no pending kitchen items', (state) =>
    expect(canConfirmDelivery(order({ state }))).toEqual({ enabled: true }),
  );

  it.each(['delivered', 'processing'])('disables on %s while kitchen items are still pending', (state) =>
    expect(canConfirmDelivery(order({ state, hasPendingKitchen: true }))).toEqual({
      enabled: false,
      reason: 'ORDER_HAS_PENDING_KITCHEN_ITEMS',
    }),
  );

  it.each(['created', 'shipped', 'finished', 'cancelled'])('disables outside delivered/processing: %s', (state) =>
    expect(canConfirmDelivery(order({ state })).enabled).toBe(false),
  );
});

function item(overrides: Partial<OrderItemActionSnapshot> = {}): OrderItemActionSnapshot {
  return { order_state: 'processing', ...overrides };
}

describe('order-action-policy — canDeliverItem (B1b)', () => {
  it.each(['cancelled', 'refunded'])(
    'rejects delivering an item whose ORDER is %s, even before checking kitchen readiness',
    (order_state) =>
      expect(canDeliverItem(item({ order_state, item_type: 'prepared', latestKitchenStatus: 'ready' }))).toEqual({
        enabled: false,
        reason: ITEM_NOT_DELIVERABLE,
      }),
  );

  it('is idempotent: an already-delivered item reads as done regardless of order state otherwise', () => {
    expect(canDeliverItem(item({ delivered_at: new Date(), item_type: 'prepared', latestKitchenStatus: 'firing' }))).toEqual(
      { enabled: true },
    );
  });

  it('blocks a prepared item until the kitchen marks it ready', () => {
    expect(canDeliverItem(item({ item_type: 'prepared', latestKitchenStatus: 'firing' }))).toEqual({
      enabled: false,
      reason: ITEM_NOT_DELIVERABLE,
    });
  });

  it('allows a prepared item once ready', () => {
    expect(canDeliverItem(item({ item_type: 'prepared', latestKitchenStatus: 'ready' }))).toEqual({
      enabled: true,
    });
  });

  it('allows a non-prepared (retail) item with no kitchen gate at all', () => {
    expect(canDeliverItem(item({ item_type: 'retail' }))).toEqual({ enabled: true });
  });
});

describe('order-action-policy — canCancelItem', () => {
  it.each(['finished', 'cancelled', 'refunded'])('rejects on order state %s', (order_state) =>
    expect(canCancelItem(item({ order_state }))).toEqual({
      enabled: false,
      reason: 'ORD_ITEM_CANCEL_STATE_001',
    }),
  );

  it('rejects once the order has a settled payment', () => {
    expect(canCancelItem(item({ orderHasSettledPayment: true }))).toEqual({
      enabled: false,
      reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
  });

  it('rejects an already-delivered item', () => {
    expect(canCancelItem(item({ delivered_at: new Date() }))).toEqual({
      enabled: false,
      reason: 'ITEM_ALREADY_DELIVERED',
    });
  });

  it('allows cancelling an ordinary unpaid, undelivered item', () => {
    expect(canCancelItem(item())).toEqual({ enabled: true });
  });
});

describe('order-action-policy — canReverseDeliveredItem', () => {
  it.each(['cancelled', 'refunded', 'finished'])('rejects on order state %s', (order_state) =>
    expect(canReverseDeliveredItem(item({ order_state, delivered_at: new Date() }))).toEqual({
      enabled: false,
      reason: 'ORD_ITEM_CANCEL_STATE_001',
    }),
  );

  it('rejects once the order has a settled payment', () => {
    expect(
      canReverseDeliveredItem(item({ delivered_at: new Date(), orderHasSettledPayment: true })),
    ).toEqual({ enabled: false, reason: 'ORD_ITEM_CANCEL_PAID_001' });
  });

  it('rejects an item that was never delivered', () => {
    expect(canReverseDeliveredItem(item({ delivered_at: null }))).toEqual({
      enabled: false,
      reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
  });

  it('allows reversing a delivered, unpaid item', () => {
    expect(canReverseDeliveredItem(item({ delivered_at: new Date() }))).toEqual({ enabled: true });
  });
});

describe('order-action-policy — canResendItem', () => {
  it('disables for a non-prepared item', () => {
    expect(canResendItem(item({ item_type: 'retail', latestKitchenStatus: 'firing' })).enabled).toBe(false);
  });

  it('disables a prepared item that was never fired', () => {
    expect(canResendItem(item({ item_type: 'prepared', latestKitchenStatus: null })).enabled).toBe(false);
  });

  it.each(['delivered', 'cancelled'])('rejects a terminal kitchen status %s', (latestKitchenStatus) =>
    expect(canResendItem(item({ item_type: 'prepared', latestKitchenStatus }))).toEqual({
      enabled: false,
      reason: 'KITCHEN_FIRE_NOT_RESENDABLE',
    }),
  );

  it('allows resending a prepared item still in flight', () => {
    expect(canResendItem(item({ item_type: 'prepared', latestKitchenStatus: 'firing' }))).toEqual({
      enabled: true,
    });
  });
});

describe('order-action-policy — computeItemActions', () => {
  it('returns all four item action codes', () => {
    const actions = computeItemActions(item({ item_type: 'retail' }));
    expect(actions.map((a) => a.code).sort()).toEqual(
      ['cancel', 'deliver', 'resend', 'reverse_delivered'].sort(),
    );
  });
});

describe('order-action-policy — computeOrderActions', () => {
  it('matches the manual getAvailableActions computation for a fresh unpaid created order', () => {
    const actions = computeOrderActions(
      order({ state: 'created', shipping_method_id: null, delivery_type: 'shipping' }),
    );
    expect(actions).toEqual([
      { code: 'pay', enabled: true },
      { code: 'cancel_payment', enabled: false },
      { code: 'cancel', enabled: true },
      { code: 'refund', enabled: false },
      { code: 'assign_shipping', enabled: true },
      { code: 'confirm_delivery', enabled: false },
    ]);
  });

  it('a finished, fully-paid order: pay/cancel_payment closed, refund open', () => {
    const actions = computeOrderActions(
      order({
        state: 'finished',
        payments: [directPayment(100)],
        shipping_method_id: 10,
        delivery_type: 'shipping',
      }),
      { roles: ['admin'] },
    );
    expect(actions).toEqual([
      { code: 'pay', enabled: false, reason: ALREADY_PAID },
      { code: 'cancel_payment', enabled: false, reason: CANCEL_FINISHED },
      { code: 'cancel', enabled: false, reason: 'ORD_CANCEL_STOCK_COMMITTED_001' },
      { code: 'refund', enabled: true },
      { code: 'assign_shipping', enabled: false },
      { code: 'confirm_delivery', enabled: false },
    ]);
  });

  it('a cashier cannot cancel_payment even when the state/payment predicate alone would allow it', () => {
    const actions = computeOrderActions(
      order({ state: 'shipped', payments: [directPayment(100)] }),
      { roles: ['cashier'] },
    );
    const cancelPayment = actions.find((a) => a.code === 'cancel_payment');
    expect(cancelPayment).toEqual({ code: 'cancel_payment', enabled: false, reason: 'FORBIDDEN' });
  });
});

// ---------------------------------------------------------------------------
// order-truth-and-invoice-tz plan — Step 1b predicates (new order-level
// action codes added alongside `getAvailableActions`'s rewrite).
// ---------------------------------------------------------------------------

describe('order-action-policy — canEditOrder', () => {
  it.each(['draft', 'created'])('enables edit for owner/admin on %s', (state) =>
    expect(canEditOrder(order({ state }), { roles: ['owner'] })).toEqual({ enabled: true }),
  );

  it.each(['pending_payment', 'processing', 'shipped', 'delivered', 'finished', 'cancelled'])(
    'disables edit outside draft/created: %s',
    (state) => expect(canEditOrder(order({ state }), { roles: ['owner'] }).enabled).toBe(false),
  );

  it('rejects a non-owner/admin role with FORBIDDEN', () => {
    expect(canEditOrder(order({ state: 'draft' }), { roles: ['cashier'] })).toEqual({
      enabled: false,
      reason: 'FORBIDDEN',
    });
  });

  it('rejects when the order is financial-split locked, even for owner', () => {
    expect(
      canEditOrder(order({ state: 'draft', active_financial_split_id: 9 }), { roles: ['owner'] }),
    ).toEqual({ enabled: false, reason: SPLIT_LOCKED });
  });
});

describe('order-action-policy — canReactivate', () => {
  it('enables only on cancelled', () => {
    expect(canReactivate({ state: 'cancelled' })).toEqual({ enabled: true });
  });

  it.each(['draft', 'created', 'pending_payment', 'processing', 'shipped', 'delivered', 'finished'])(
    'disables outside cancelled: %s',
    (state) => expect(canReactivate({ state }).enabled).toBe(false),
  );
});

describe('order-action-policy — canFastTrack', () => {
  const FAST_TRACK_STATE = 'ORD_FAST_TRACK_INVALID_STATE_001';
  const SHIP_REQUIRED_FOR_FLOW = 'ORD_SHIP_REQUIRED_FOR_FLOW_001';

  it.each(['finished', 'cancelled', 'refunded'])('rejects a terminal state: %s', (state) =>
    expect(canFastTrack({ state, delivery_type: 'direct_delivery', hasOrderItems: true })).toEqual({
      enabled: false,
      reason: FAST_TRACK_STATE,
    }),
  );

  it('requires a shipping method for a non-direct-delivery order', () => {
    expect(
      canFastTrack({
        state: 'processing',
        delivery_type: 'shipping',
        shipping_method_id: null,
        hasOrderItems: true,
      }),
    ).toEqual({ enabled: false, reason: SHIP_REQUIRED_FOR_FLOW });
  });

  it('rejects an order with no items', () => {
    expect(
      canFastTrack({ state: 'processing', delivery_type: 'direct_delivery', hasOrderItems: false }),
    ).toEqual({ enabled: false });
  });

  it('allows a direct_delivery order with items in a non-terminal state', () => {
    expect(
      canFastTrack({ state: 'pending_payment', delivery_type: 'direct_delivery', hasOrderItems: true }),
    ).toEqual({ enabled: true });
  });

  it('allows a shipping order once a method is assigned', () => {
    expect(
      canFastTrack({
        state: 'processing',
        delivery_type: 'shipping',
        shipping_method_id: 4,
        hasOrderItems: true,
      }),
    ).toEqual({ enabled: true });
  });
});

describe('order-action-policy — canCreditPayment', () => {
  it('disables for a non-credit order (payment_form !== "2")', () => {
    expect(canCreditPayment({ state: 'pending_payment', payment_form: '1' })).toEqual({
      enabled: false,
    });
  });

  it('disables when financial-split locked, even a credit order in pending_payment', () => {
    expect(
      canCreditPayment({ state: 'pending_payment', payment_form: '2', active_financial_split_id: 3 }),
    ).toEqual({ enabled: false, reason: SPLIT_LOCKED });
  });

  it('enables unconditionally for a credit order in pending_payment', () => {
    expect(canCreditPayment({ state: 'pending_payment', payment_form: '2' })).toEqual({
      enabled: true,
    });
  });

  it('enables in finished only while remaining_balance exceeds the 0.01 threshold', () => {
    expect(canCreditPayment({ state: 'finished', payment_form: '2', remaining_balance: 50 })).toEqual({
      enabled: true,
    });
    expect(canCreditPayment({ state: 'finished', payment_form: '2', remaining_balance: 0 })).toEqual({
      enabled: false,
    });
  });

  it('disables outside pending_payment/finished', () => {
    expect(canCreditPayment({ state: 'processing', payment_form: '2' })).toEqual({ enabled: false });
  });
});

function dispatchOrder(
  overrides: Partial<{ state: string; delivery_type: string | null; isKitchenOrder: boolean }> = {},
) {
  return {
    state: 'pending_payment',
    delivery_type: 'direct_delivery',
    isKitchenOrder: false,
    ...overrides,
  };
}

describe('order-action-policy — canDispatchOrder', () => {
  it.each(['pending_payment', 'processing'])('enables for a home_delivery order in %s', (state) =>
    expect(canDispatchOrder(dispatchOrder({ state, delivery_type: 'home_delivery' }))).toEqual({
      enabled: true,
    }),
  );

  it('enables for a kitchen order (mesa/mostrador) headed home', () => {
    expect(
      canDispatchOrder(dispatchOrder({ delivery_type: 'home_delivery', isKitchenOrder: true })),
    ).toEqual({ enabled: true });
  });

  it('disables for a plain direct_delivery order with no kitchen involvement', () => {
    expect(canDispatchOrder(dispatchOrder({ delivery_type: 'direct_delivery' })).enabled).toBe(false);
  });

  it('disables for a kitchen pickup order (nothing to route home)', () => {
    expect(
      canDispatchOrder(dispatchOrder({ delivery_type: 'pickup', isKitchenOrder: true })).enabled,
    ).toBe(false);
  });

  it.each(['draft', 'created', 'shipped', 'delivered', 'finished', 'cancelled'])(
    'disables outside pending_payment/processing: %s',
    (state) =>
      expect(canDispatchOrder(dispatchOrder({ state, delivery_type: 'home_delivery' })).enabled).toBe(
        false,
      ),
  );
});

describe('order-action-policy — canManualShip', () => {
  it('enables a kitchen "other" order in pending_payment that cannot generate a remisión', () => {
    expect(canManualShip(dispatchOrder({ delivery_type: 'other', isKitchenOrder: true }))).toEqual({
      enabled: true,
    });
  });

  it('disables a home_delivery order (it can always generate a remisión instead)', () => {
    expect(
      canManualShip(dispatchOrder({ delivery_type: 'home_delivery', isKitchenOrder: true })).enabled,
    ).toBe(false);
  });

  it('disables a pickup order', () => {
    expect(canManualShip(dispatchOrder({ delivery_type: 'pickup', isKitchenOrder: true })).enabled).toBe(
      false,
    );
  });

  it('disables outside pending_payment', () => {
    expect(
      canManualShip(
        dispatchOrder({ state: 'processing', delivery_type: 'other', isKitchenOrder: true }),
      ).enabled,
    ).toBe(false);
  });
});

describe('order-action-policy — canReadyForPickupBeforePayment', () => {
  it('enables a pickup order in pending_payment regardless of kitchen status', () => {
    expect(canReadyForPickupBeforePayment(dispatchOrder({ delivery_type: 'pickup' }))).toEqual({
      enabled: true,
    });
  });

  it('disables a non-pickup order', () => {
    expect(
      canReadyForPickupBeforePayment(dispatchOrder({ delivery_type: 'home_delivery' })).enabled,
    ).toBe(false);
  });

  it('disables outside pending_payment', () => {
    expect(
      canReadyForPickupBeforePayment(dispatchOrder({ state: 'processing', delivery_type: 'pickup' }))
        .enabled,
    ).toBe(false);
  });
});

describe('order-action-policy — canDirectDeliver', () => {
  it('enables a kitchen pickup order in processing (self-caught fix: was permanently disabled)', () => {
    expect(
      canDirectDeliver(
        dispatchOrder({ state: 'processing', delivery_type: 'pickup', isKitchenOrder: true }),
      ),
    ).toEqual({ enabled: true });
  });

  it('disables a non-kitchen pickup order in processing (nothing was ever fired)', () => {
    expect(
      canDirectDeliver(
        dispatchOrder({ state: 'processing', delivery_type: 'pickup', isKitchenOrder: false }),
      ).enabled,
    ).toBe(false);
  });

  it('disables a non-pickup order', () => {
    expect(
      canDirectDeliver(
        dispatchOrder({ state: 'processing', delivery_type: 'home_delivery', isKitchenOrder: true }),
      ).enabled,
    ).toBe(false);
  });

  it('disables outside processing', () => {
    expect(
      canDirectDeliver(
        dispatchOrder({ state: 'pending_payment', delivery_type: 'pickup', isKitchenOrder: true }),
      ).enabled,
    ).toBe(false);
  });
});
