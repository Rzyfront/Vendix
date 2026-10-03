import {
  canPay,
  canCancelPayment,
  canCancelPaymentAsRole,
  canRefund,
  canCancel,
  canConfirmPayment,
  canAssignShipping,
  canConfirmDelivery,
  canEditOrder,
  canReactivate,
  canReactivateAsRole,
  canFastTrack,
  canCreditPayment,
  requiresPaymentRegistration,
  canDispatchOrder,
  canManualShip,
  canReadyForPickupBeforePayment,
  canDirectDeliver,
  canCollectViaShip,
  hasKitchenLinesAwaitingHandoff,
  kitchenHandoffBlocker,
  describeKitchenHandoffBlocker,
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

function order(
  overrides: Partial<OrderActionSnapshot> & { remaining_balance?: number | null } = {},
): OrderActionSnapshot {
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

function bankTransferPayment(amount: number): NonNullable<OrderActionSnapshot['payments']>[number] {
  // Sembrada `processing_mode: 'ONLINE'` en todas las tiendas, pero se
  // confirma a mano: no hay pasarela que reversar.
  return {
    state: 'succeeded',
    amount,
    store_payment_method: { system_payment_method: { processing_mode: 'ONLINE', type: 'bank_transfer' } },
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

  it.each(['shipped', 'delivered', 'pending_payment', 'processing'])(
    'enables cancel_payment on %s for a settled bank transfer seeded ONLINE (local void, like cash)',
    (state) => {
      expect(canCancelPayment(order({ state, payments: [bankTransferPayment(100)] }))).toEqual({
        enabled: true,
      });
    },
  );

  it('keeps requiring a gateway reversal when a bank transfer is mixed with a Wompi leg', () => {
    expect(
      canCancelPayment(
        order({ state: 'delivered', payments: [bankTransferPayment(50), gatewayPayment(50)] }),
      ),
    ).toEqual({ enabled: false, reason: REVERSAL_REQUIRED });
  });

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
  it.each(['delivered', 'processing'])('enables on %s with no pending kitchen items (paid)', (state) =>
    expect(
      canConfirmDelivery(order({ state, remaining_balance: 0, payments: [directPayment(100)] })),
    ).toEqual({ enabled: true }),
  );

  it.each(['delivered', 'processing'])('disables on %s with an unpaid non-credit balance', (state) =>
    expect(canConfirmDelivery(order({ state }))).toEqual({
      enabled: false,
      reason: 'ORD_FINISH_UNPAID_BALANCE_001',
    }),
  );

  it('enables an unpaid credit sale (payment_form 2)', () =>
    expect(canConfirmDelivery(order({ state: 'delivered', payment_form: '2' }))).toEqual({ enabled: true }),
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

  it('gates a physical order item whose product is prepared and KDS is pending', () => {
    expect(canDeliverItem(item({ item_type: 'physical', product_type: 'prepared', latestKitchenStatus: 'pending' }))).toEqual({
      enabled: false,
      reason: ITEM_NOT_DELIVERABLE,
    });
  });

  it('allows a prepared stock item to bypass KDS only without a ticket', () => {
    expect(canDeliverItem(item({ item_type: 'physical', product_type: 'prepared', skip_kds: true }))).toEqual({ enabled: true });
    expect(canDeliverItem(item({ item_type: 'physical', product_type: 'prepared', skip_kds: true, latestKitchenStatus: 'pending' }))).toEqual({
      enabled: false,
      reason: ITEM_NOT_DELIVERABLE,
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
  it('does not offer a second reversal after a delivered item was cancelled', () => {
    expect(canReverseDeliveredItem(item({
      delivered_at: new Date(), cancelled_at: new Date(),
    }))).toEqual({ enabled: false, reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' });
  });

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

describe('order-action-policy — canReactivateAsRole', () => {
  const eligible = { state: 'cancelled' };

  it('permits owner/admin (case-insensitive)', () => {
    expect(canReactivateAsRole(eligible, { roles: ['OWNER'] })).toEqual({ enabled: true });
    expect(canReactivateAsRole(eligible, { roles: ['admin'] })).toEqual({ enabled: true });
  });

  it('forbids a non owner/admin role regardless of state eligibility', () => {
    expect(canReactivateAsRole(eligible, { roles: ['cashier'] })).toEqual({
      enabled: false,
      reason: 'FORBIDDEN',
    });
  });

  it('stays permissive (delegates to the state predicate) when roles are not resolved', () => {
    expect(canReactivateAsRole(eligible, {})).toEqual({ enabled: true });
  });

  it('still disables outside cancelled, even for owner/admin', () => {
    expect(canReactivateAsRole({ state: 'processing' }, { roles: ['owner'] }).enabled).toBe(false);
  });
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

  // Task B — fast track exempts pickup/dine_in from the shipping-method
  // requirement too (mirrors OrderFlowService's widened
  // SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES, fast-track-only).
  it.each(['pickup', 'dine_in'])('allows %s with no shipping method assigned', (delivery_type) => {
    expect(
      canFastTrack({
        state: 'processing',
        delivery_type,
        shipping_method_id: null,
        hasOrderItems: true,
      }),
    ).toEqual({ enabled: true });
  });

  it('still rejects home_delivery with no shipping method — same error as always, NOT in the exempt set', () => {
    expect(
      canFastTrack({
        state: 'processing',
        delivery_type: 'home_delivery',
        shipping_method_id: null,
        hasOrderItems: true,
      }),
    ).toEqual({ enabled: false, reason: SHIP_REQUIRED_FOR_FLOW });
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
  overrides: Partial<{ state: string; delivery_type: string | null; isKitchenOrder: boolean; hasPendingKitchen: boolean }> = {},
) {
  return {
    state: 'pending_payment',
    delivery_type: 'direct_delivery',
    isKitchenOrder: false,
    ...overrides,
  };
}

describe('order-action-policy — canDispatchOrder', () => {
  it('blocks whole-order dispatch until kitchen hand-off', () => {
    expect(canDispatchOrder(dispatchOrder({ state: 'processing', delivery_type: 'home_delivery', hasPendingKitchen: true }))).toEqual({
      enabled: false, reason: 'ORDER_HAS_PENDING_KITCHEN_ITEMS',
    });
  });
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

describe('order-action-policy — kitchen hand-off', () => {
  const prepared = (status?: string, skip_kds = false) => ({
    cancelled_at: null,
    skip_kds,
    products: { product_type: 'prepared' },
    kitchen_ticket_items: status ? [{ status }] : [],
  });

  it('blocks an unfired, pending or ready dish in a mixed order', () => {
    const direct = { products: { product_type: 'physical' }, kitchen_ticket_items: [] };
    for (const status of [undefined, 'pending', 'in_preparation', 'ready']) {
      expect(hasKitchenLinesAwaitingHandoff([direct, prepared(status)])).toBe(true);
    }
  });

  it('allows handed-off, financially cancelled and stocked skip-KDS dishes', () => {
    expect(hasKitchenLinesAwaitingHandoff([prepared('delivered')])).toBe(false);
    expect(hasKitchenLinesAwaitingHandoff([prepared('cancelled')])).toBe(true);
    expect(hasKitchenLinesAwaitingHandoff([prepared(undefined, true)])).toBe(false);
    expect(hasKitchenLinesAwaitingHandoff([prepared('pending', true)])).toBe(true);
    expect(hasKitchenLinesAwaitingHandoff([{
      products: { product_type: 'physical' },
      skip_kds: true,
      kitchen_ticket_items: [{ status: 'pending' }],
    }])).toBe(true);
    expect(hasKitchenLinesAwaitingHandoff([{ ...prepared('pending'), cancelled_at: new Date() }])).toBe(false);
  });

  // H3 fix (regression): a store that dropped the `restaurant` industry but
  // kept legacy `prepared`/`skip_kds:false` catalog rows must not get stuck
  // unable to ship/deliver/finish/remisionar those orders — a never-fired
  // line only blocks when the store IS a restaurant. Once a real kitchen
  // ticket exists the flag is irrelevant (a real ticket already happened).
  it('gates the never-fired branch on isRestaurant, but a real ticket always blocks regardless', () => {
    const neverFired = prepared(undefined, false);
    expect(hasKitchenLinesAwaitingHandoff([neverFired], { isRestaurant: false })).toBe(false);
    expect(hasKitchenLinesAwaitingHandoff([neverFired], { isRestaurant: true })).toBe(true);
    // Default (no ctx) preserves historic behavior — same as isRestaurant: true.
    expect(hasKitchenLinesAwaitingHandoff([neverFired])).toBe(true);

    const stillPending = prepared('pending', false);
    expect(hasKitchenLinesAwaitingHandoff([stillPending], { isRestaurant: false })).toBe(true);
    expect(hasKitchenLinesAwaitingHandoff([stillPending], { isRestaurant: true })).toBe(true);

    const delivered = prepared('delivered', false);
    expect(hasKitchenLinesAwaitingHandoff([delivered], { isRestaurant: false })).toBe(false);
    expect(hasKitchenLinesAwaitingHandoff([delivered], { isRestaurant: true })).toBe(false);
  });

  it('reports a distinct cancelled_ticket reason with the item name, separate from a merely pending one', () => {
    const cancelledTicket = { ...prepared('cancelled', false), product_name: 'Bandeja Paisa' };
    const blocker = kitchenHandoffBlocker([cancelledTicket], { isRestaurant: true });
    expect(blocker).toEqual({ reason: 'cancelled_ticket', itemName: 'Bandeja Paisa' });
    expect(describeKitchenHandoffBlocker(blocker!)).toBe(
      'El plato "Bandeja Paisa" tiene su comanda cancelada en cocina: reenvíala a cocina o cancela el ítem antes de despachar.',
    );

    const pendingTicket = { ...prepared('pending', false), product_name: 'Bandeja Paisa' };
    const pendingBlocker = kitchenHandoffBlocker([pendingTicket], { isRestaurant: true });
    expect(pendingBlocker).toEqual({ reason: 'pending', itemName: 'Bandeja Paisa' });
    // `pending` keeps the entry's own generic devMessage — no override.
    expect(describeKitchenHandoffBlocker(pendingBlocker!)).toBeUndefined();
  });

  it('returns null (no blocker) once nothing in the order blocks', () => {
    expect(kitchenHandoffBlocker([prepared('delivered')], { isRestaurant: true })).toBeNull();
    expect(kitchenHandoffBlocker([prepared(undefined, false)], { isRestaurant: false })).toBeNull();
  });
});

describe('order-action-policy — canDeliverItem restaurant gate (H3 fix)', () => {
  const baseItem = {
    order_state: 'processing',
    delivered_at: null,
    item_type: 'physical',
    product_type: 'prepared',
    skip_kds: false,
  };

  it('blocks a never-fired prepared line when the store is a restaurant', () => {
    expect(canDeliverItem({ ...baseItem, isRestaurant: true })).toEqual({
      enabled: false,
      reason: ITEM_NOT_DELIVERABLE,
    });
  });

  it('allows a never-fired prepared line when the store is NOT a restaurant', () => {
    expect(canDeliverItem({ ...baseItem, isRestaurant: false })).toEqual({ enabled: true });
  });

  it('defaults to the historic (restaurant) behavior when isRestaurant is unresolved', () => {
    expect(canDeliverItem(baseItem).enabled).toBe(false);
  });

  it('still requires reaching ready once a real ticket exists, regardless of isRestaurant', () => {
    expect(
      canDeliverItem({ ...baseItem, isRestaurant: false, latestKitchenStatus: 'pending' }),
    ).toEqual({ enabled: false, reason: ITEM_NOT_DELIVERABLE });
    expect(
      canDeliverItem({ ...baseItem, isRestaurant: false, latestKitchenStatus: 'ready' }),
    ).toEqual({ enabled: true });
  });
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

function collectOrder(
  overrides: Partial<OrderActionSnapshot & { delivery_type: string | null; isKitchenOrder: boolean }> = {},
) {
  return {
    state: 'processing',
    grand_total: 100,
    payments: [],
    refunds: [],
    delivery_type: 'direct_delivery',
    isKitchenOrder: false,
    ...overrides,
  };
}

describe('order-action-policy — canCollectViaShip', () => {
  it('enables a direct_delivery, non-kitchen, unpaid order in processing — restores the web\'s removed `ship` ("Pasar a Cobro")', () => {
    expect(canCollectViaShip(collectOrder())).toEqual({ enabled: true });
  });

  it('enables a pickup/other, non-kitchen, unpaid order in processing (same "no fulfillment" formula, independent of delivery_type)', () => {
    expect(canCollectViaShip(collectOrder({ delivery_type: 'pickup' }))).toEqual({ enabled: true });
    expect(canCollectViaShip(collectOrder({ delivery_type: 'other' }))).toEqual({ enabled: true });
  });

  it('disables a home_delivery order — always offers `dispatch_order` instead (canOfferDispatchFlow is true)', () => {
    expect(canCollectViaShip(collectOrder({ delivery_type: 'home_delivery' })).enabled).toBe(false);
  });

  it('disables a kitchen order — offers `dispatch_order`/`direct_deliver`/`confirm_delivery` instead', () => {
    expect(canCollectViaShip(collectOrder({ isKitchenOrder: true })).enabled).toBe(false);
  });

  it('disables when financial-split locked, even with no fulfillment', () => {
    expect(canCollectViaShip(collectOrder({ active_financial_split_id: 7 }))).toEqual({
      enabled: false,
      reason: SPLIT_LOCKED,
    });
  });

  it('disables once fully paid (mirrors `canPay`\'s already-paid reason)', () => {
    expect(
      canCollectViaShip(collectOrder({ payments: [directPayment(100)] })),
    ).toEqual({ enabled: false, reason: ALREADY_PAID });
  });

  it('disables outside processing', () => {
    expect(canCollectViaShip(collectOrder({ state: 'pending_payment' })).enabled).toBe(false);
  });
});

describe('D — canCancelPayment: el stock comprometido NO bloquea cancelar el pago (regla del dueño)', () => {
  const committed = [{ inventory_committed: true, inventory_consumed_at_fire: false }];

  it.each(['processing', 'pending_payment'])(
    '%s con stock comprometido + pago directo → cancelar pago habilitado; cancelar orden sigue bloqueado',
    (state) => {
      const snap = order({ state, order_items: committed, payments: [directPayment(100)] });
      expect(canCancelPayment(snap)).toEqual({ enabled: true });
      expect(canCancel(snap)).toEqual(
        expect.objectContaining({ enabled: false, reason: 'ORD_CANCEL_STOCK_COMMITTED_001' }),
      );
    },
  );

  it('processing con factura de venta emitida → ORD_PAYMENT_CANCEL_INVOICED_001 (misma regla que el servicio)', () => {
    expect(
      canCancelPayment(order({
        state: 'processing',
        order_items: committed,
        payments: [directPayment(100)],
        hasIssuedSalesInvoice: true,
      })),
    ).toEqual({ enabled: false, reason: INVOICED });
  });

  it('processing con pasarela liquidada → sigue exigiendo reversa, con o sin stock comprometido', () => {
    for (const order_items of [committed, [{ inventory_committed: false, inventory_consumed_at_fire: false }]]) {
      expect(
        canCancelPayment(order({ state: 'processing', order_items, payments: [gatewayPayment(100)] })),
      ).toEqual({ enabled: false, reason: REVERSAL_REQUIRED });
    }
  });

  it('finished sigue rechazando aunque el stock esté comprometido y el pago sea efectivo', () => {
    expect(
      canCancelPayment(order({ state: 'finished', order_items: committed, payments: [directPayment(100)] })),
    ).toEqual({ enabled: false, reason: CANCEL_FINISHED });
  });
});

describe('order-action-policy — requiresPaymentRegistration (Fase 2 paso 6)', () => {
  const manualPending = (type = 'bank_transfer', processing_mode = 'ONLINE') => ({
    state: 'pending',
    amount: 100,
    store_payment_method: { system_payment_method: { processing_mode, type } },
  });

  it.each([
    ['bank_transfer pendiente', manualPending('bank_transfer', 'ONLINE')],
    ['voucher pendiente', manualPending('voucher', 'ONLINE')],
    ['card DIRECT pendiente', manualPending('card', 'DIRECT')],
  ])('pago manual pendiente → registra (%s)', (_label, payment) => {
    expect(
      requiresPaymentRegistration(order({ state: 'pending_payment', remaining_balance: 0, payments: [payment] })),
    ).toBe(true);
  });

  it('saldo parcial sin marcador pendiente → registra (remaining_balance > 0)', () => {
    expect(
      requiresPaymentRegistration(order({
        state: 'pending_payment',
        grand_total: 100,
        remaining_balance: 40,
        payments: [directPayment(60)],
      })),
    ).toBe(true);
  });

  it.each([
    ['wompi pendiente saldado', { remaining_balance: 0, payments: [{ state: 'pending', amount: 100, store_payment_method: { system_payment_method: { processing_mode: 'ONLINE', type: 'wompi' } } }] }],
    ['wallet pendiente saldado', { remaining_balance: 0, payments: [{ state: 'pending', amount: 100, store_payment_method: { system_payment_method: { processing_mode: 'DIRECT', type: 'wallet' } } }] }],
    ['contra entrega saldada', { remaining_balance: 0, payments: [{ state: 'pending', amount: 100, store_payment_method: { system_payment_method: { processing_mode: 'ON_DELIVERY', type: 'cash_on_delivery' } } }] }],
    ['pending sin método resoluble saldado (fail-closed)', { remaining_balance: 0, payments: [{ state: 'pending', amount: 100, store_payment_method: null }] }],
    ['sin pagos y sin saldo', { remaining_balance: 0, payments: [] }],
  ])('%s → no registra (sigue confirm_payment)', (_label, snapshot) => {
    expect(requiresPaymentRegistration(order({ state: 'pending_payment', ...snapshot }))).toBe(false);
  });

  it('fuera de pending_payment nunca registra aunque haya saldo', () => {
    for (const state of ['created', 'processing', 'shipped', 'delivered', 'finished']) {
      expect(
        requiresPaymentRegistration(order({ state, remaining_balance: 40, payments: [manualPending()] })),
      ).toBe(false);
    }
  });
});

describe('order-action-policy — bloqueo por cuenta dividida (cobro de la orden principal)', () => {
  it('canCancel queda deshabilitado con SPLIT_ACCOUNT_LOCKED si hay split activo', () => {
    expect(canCancel(order({ state: 'created', active_financial_split_id: 5 }))).toEqual({
      enabled: false,
      reason: SPLIT_LOCKED,
    });
  });

  it('canConfirmPayment: habilitado sin split, bloqueado con split', () => {
    expect(canConfirmPayment(order({ state: 'pending_payment' }))).toEqual({ enabled: true });
    expect(
      canConfirmPayment(order({ state: 'pending_payment', active_financial_split_id: 5 })),
    ).toEqual({ enabled: false, reason: SPLIT_LOCKED });
  });
});
