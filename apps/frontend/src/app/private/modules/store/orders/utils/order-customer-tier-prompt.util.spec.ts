import { orderCustomerTierPrompt } from './order-customer-tier-prompt.util';
import { OrderItem } from '../interfaces/order.interface';

const TIER = { id: 82, name: 'Preferencial 10' };

const item = (id: number, over: Partial<OrderItem> = {}): OrderItem =>
  ({
    id,
    order_id: 1,
    product_id: 10 + id,
    product_name: `Producto ${id}`,
    quantity: 1,
    unit_price: 10,
    total_price: 10,
    created_at: '',
    updated_at: '',
    applied_price_tier_id: null,
    products: {
      id: 10 + id,
      name: `Producto ${id}`,
      sku: 'X',
      price: 10,
      final_price: 10,
      has_multiple_price_tiers: true,
      product_price_tier_assignments: [{ price_tier_id: 82 }],
    },
    ...over,
  }) as OrderItem;

describe('orderCustomerTierPrompt', () => {
  it('ofrece aplicar la tarifa en las líneas que la admiten', () => {
    const prompt = orderCustomerTierPrompt({
      items: [item(1), item(2, { applied_price_tier_id: 82 })],
      previousTier: null,
      nextTier: TIER,
      canApplyTier: true,
    });
    expect(prompt).toEqual({
      mode: 'apply',
      tier: TIER,
      lines: [{ itemId: '1', label: 'Producto 1' }],
    });
  });

  it('no ofrece líneas canceladas, por peso, con precio a mano, presentación o sin la tarifa', () => {
    const base = item(1).products!;
    const prompt = orderCustomerTierPrompt({
      items: [
        item(1, { cancelled_at: '2026-10-28' }),
        item(2, { weight: '1.5' }),
        item(3, { is_price_overridden: true }),
        item(4, { stock_units_consumed: 6 }),
        item(5, { products: { ...base, has_multiple_price_tiers: false } }),
        item(6, { products: { ...base, product_price_tier_assignments: [] } }),
      ],
      previousTier: null,
      nextTier: TIER,
      canApplyTier: true,
    });
    expect(prompt).toBeNull();
  });

  it('al quitar un cliente con tarifa ofrece restaurar las líneas que la llevan', () => {
    const prompt = orderCustomerTierPrompt({
      items: [item(1, { applied_price_tier_id: 82 }), item(2)],
      previousTier: TIER,
      nextTier: null,
      canApplyTier: true,
    });
    expect(prompt).toEqual({
      mode: 'restore',
      tier: TIER,
      lines: [{ itemId: '1', label: 'Producto 1' }],
    });
  });

  it('al cambiar a un cliente con otra tarifa guarda las líneas editables de la anterior', () => {
    const OTHER = { id: 90, name: 'Mayorista' };
    const prompt = orderCustomerTierPrompt({
      items: [
        item(1, { applied_price_tier_id: 90 }),
        item(2, {
          applied_price_tier_id: 90,
          products: { ...item(2).products!, product_price_tier_assignments: [{ price_tier_id: 90 }] },
        }),
        item(3, { applied_price_tier_id: 90, is_price_overridden: true }),
      ],
      previousTier: OTHER,
      nextTier: TIER,
      canApplyTier: true,
    });
    expect(prompt?.mode).toBe('apply');
    expect(prompt?.lines.map((l) => l.itemId)).toEqual(['1']);
    expect(prompt?.restoreAfter).toEqual({
      tier: OTHER,
      lines: [
        { itemId: '1', label: 'Producto 1' },
        { itemId: '2', label: 'Producto 2' },
      ],
    });
  });

  it('sin permiso para aplicar tarifas no pregunta', () => {
    expect(
      orderCustomerTierPrompt({
        items: [item(1)],
        previousTier: null,
        nextTier: TIER,
        canApplyTier: false,
      }),
    ).toBeNull();
  });
});
