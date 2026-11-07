import { Prisma } from '@prisma/client';
import {
  WORKFLOW_EVENT_TOKENS,
  WORKFLOW_TRIGGER_EVENTS,
  WorkflowTriggerEvent,
} from '@common/workflows/contract';
import {
  EVENT_BUSINESS_ID_KEYS,
  extractTriggerEvent,
} from './workflow-trigger.events';

/** Business-id keys that identify the fact but are not exposed as tokens. */
const KEYS_OUTSIDE_TOKENS: Partial<Record<WorkflowTriggerEvent, string[]>> = {
  'order.status_changed': ['transition_id'],
  'purchase_order.received': ['reception_id'],
  'stock.low': ['occurred_on'],
};

/** A payload that carries every token and business key of the event. */
function fullPayload(event: WorkflowTriggerEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = { store_id: 11 };
  const keys = [
    ...WORKFLOW_EVENT_TOKENS[event],
    ...EVENT_BUSINESS_ID_KEYS[event],
  ];
  keys.forEach((key, index) => {
    payload[key] = key.endsWith('_id') || key === 'occurred_on' ? index + 1 : `v${index}`;
  });
  return payload;
}

describe('workflow trigger events: registry and payload reader', () => {
  it('every event of the registry has its business-id keys', () => {
    for (const event of WORKFLOW_TRIGGER_EVENTS) {
      expect(EVENT_BUSINESS_ID_KEYS[event]).toBeDefined();
      expect(EVENT_BUSINESS_ID_KEYS[event].length).toBeGreaterThan(0);
    }
    expect(Object.keys(EVENT_BUSINESS_ID_KEYS).sort()).toEqual(
      [...WORKFLOW_TRIGGER_EVENTS].sort(),
    );
  });

  it('every business-id key is a token, except the declared extras', () => {
    for (const event of WORKFLOW_TRIGGER_EVENTS) {
      const tokens = WORKFLOW_EVENT_TOKENS[event];
      const extras = KEYS_OUTSIDE_TOKENS[event] ?? [];
      for (const key of EVENT_BUSINESS_ID_KEYS[event]) {
        expect(tokens.includes(key) || extras.includes(key)).toBe(true);
      }
    }
  });

  it('builds the closed context (exactly the tokens) for all 28 events', () => {
    expect(WORKFLOW_TRIGGER_EVENTS).toHaveLength(28);
    for (const event of WORKFLOW_TRIGGER_EVENTS) {
      if (event === 'pqr.created') continue; // reads a nested ticket payload
      const info = extractTriggerEvent(event, fullPayload(event));
      expect(info).not.toBeNull();
      expect(info?.store_id).toBe(11);
      expect(Object.keys(info?.context ?? {}).sort()).toEqual(
        [...WORKFLOW_EVENT_TOKENS[event]].sort(),
      );
    }
  });

  it('order.status_changed: Decimals become strings and the transition id is part of the business id', () => {
    const info = extractTriggerEvent('order.status_changed', {
      store_id: 11,
      order_id: 9001,
      order_number: 'ORD-7',
      from_state: 'processing',
      to_state: 'shipped',
      grand_total: new Prisma.Decimal('4500.50'),
      transition_id: 55,
    });
    expect(info).toEqual({
      store_id: 11,
      business_id: '9001:shipped:55',
      context: {
        order_id: 9001,
        order_number: 'ORD-7',
        from_state: 'processing',
        to_state: 'shipped',
        grand_total: '4500.5',
      },
    });
  });

  it('stock.low: one business id per product, location and day', () => {
    const payload = {
      store_id: 11,
      product_id: 9,
      product_name: 'Cable HDMI',
      location_id: 4,
      quantity_available: 3,
      reorder_point: 5,
      occurred_on: '2026-11-07',
    };
    const info = extractTriggerEvent('stock.low', payload);
    expect(info?.business_id).toBe('9:4:2026-11-07');
    expect(info?.context).toEqual({
      product_id: 9,
      product_name: 'Cable HDMI',
      location_id: 4,
      quantity_available: 3,
      reorder_point: 5,
    });
    expect(
      extractTriggerEvent('stock.low', { ...payload, occurred_on: '2026-11-08' })
        ?.business_id,
    ).toBe('9:4:2026-11-08');
  });

  it('dates become ISO strings and payment/transfer events keep their ids', () => {
    const start = new Date('2026-11-01T00:00:00.000Z');
    const run = extractTriggerEvent('payroll_run.approved', {
      store_id: 11,
      payroll_run_id: 4,
      payroll_number: 'NOM-1',
      total_net: new Prisma.Decimal(1000),
      period_start: start,
      period_end: new Date('2026-11-30T00:00:00.000Z'),
    });
    expect(run?.context).toMatchObject({
      payroll_run_id: 4,
      total_net: '1000',
      period_start: '2026-11-01T00:00:00.000Z',
    });

    const transfer = extractTriggerEvent('inventory.transferred', {
      store_id: 11,
      transfer_id: 70,
      transfer_number: 'TR-70',
      from_location_id: 1,
      to_location_id: 2,
    });
    expect(transfer?.business_id).toBe('70');
  });

  it('returns null without a store, without the business id, or for an unknown event', () => {
    const payload = fullPayload('expense.created');
    expect(extractTriggerEvent('expense.created', { ...payload, store_id: undefined })).toBeNull();
    expect(extractTriggerEvent('expense.created', { ...payload, expense_id: undefined })).toBeNull();
    expect(extractTriggerEvent('expense.unknown', payload)).toBeNull();
    expect(extractTriggerEvent('expense.created', null)).toBeNull();
  });
});
