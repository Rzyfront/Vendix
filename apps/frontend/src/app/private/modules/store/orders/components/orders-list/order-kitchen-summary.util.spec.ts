import { OrderItem } from '../../interfaces/order.interface';
import { kitchenProgressLabel, summarizeOrderKitchen } from './order-kitchen-summary.util';

function item(
  id: number,
  overrides: Partial<OrderItem> = {},
): OrderItem {
  return {
    id,
    order_id: 1,
    product_id: id,
    product_name: `Plato ${id}`,
    quantity: 1,
    unit_price: 10,
    total_price: 10,
    created_at: '',
    updated_at: '',
    products: { id, name: `Plato ${id}`, sku: '', price: 10, final_price: 10, product_type: 'prepared' },
    ...overrides,
  };
}

describe('summarizeOrderKitchen', () => {
  it('returns no summary for an order without prepared lines', () => {
    const summary = summarizeOrderKitchen([
      item(1, { products: { id: 1, name: 'Fisico', sku: '', price: 10, final_price: 10, product_type: 'physical' } }),
      item(2, { skip_kds: true }),
      item(3, { cancelled_at: '2026-01-01' }),
    ]);
    expect(summary.eligibleItems).toEqual([]);
    expect(summary.status).toBeNull();
  });

  it('shows an unfired eligible line as pending and returns its id once', () => {
    const summary = summarizeOrderKitchen([item(7)]);
    expect(summary.pendingItemIds).toEqual([7]);
    expect(summary.status).toBe('pending');
    expect(kitchenProgressLabel(summary)).toBe('0/1 platos listos');
  });

  it('preserves fired lines in the denominator while returning only unfired ids', () => {
    const summary = summarizeOrderKitchen([
      item(1, {
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [{ id: 1, status: 'ready', kitchen_ticket_id: 10 }],
      }),
      item(2),
    ]);
    expect(summary.totalQuantity).toBe(2);
    expect(summary.completedQuantity).toBe(1);
    expect(summary.pendingItemIds).toEqual([2]);
    expect(summary.pendingQuantity).toBe(1);
    expect(summary.status).toBe('pending');
  });

  it('weights progress by quantity', () => {
    const summary = summarizeOrderKitchen([
      item(1, {
        quantity: 3,
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [{ id: 1, status: 'ready', kitchen_ticket_id: 10 }],
      }),
      item(2, {
        quantity: 2,
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [{ id: 2, status: 'in_preparation', kitchen_ticket_id: 11 }],
      }),
    ]);
    expect(summary.totalQuantity).toBe(5);
    expect(summary.completedQuantity).toBe(3);
    expect(summary.status).toBe('in_preparation');
    expect(summary.pendingQuantity).toBe(0);
  });

  it('prefers an active re-fire attempt over a newer terminal attempt', () => {
    const summary = summarizeOrderKitchen([
      item(1, {
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [
          { id: 2, status: 'cancelled', kitchen_ticket_id: 12 },
          { id: 1, status: 'in_preparation', kitchen_ticket_id: 11 },
        ],
      }),
    ]);
    expect(summary.status).toBe('in_preparation');
  });

  it('uses the slowest dish state and never paints a cancelled line green', () => {
    const summary = summarizeOrderKitchen([
      item(1, {
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [{ id: 1, status: 'delivered', kitchen_ticket_id: 10 }],
      }),
      item(2, {
        inventory_consumed_at_fire: true,
        kitchen_ticket_items: [{ id: 2, status: 'cancelled', kitchen_ticket_id: 11 }],
      }),
    ]);
    expect(summary.status).toBe('cancelled');
  });
});
