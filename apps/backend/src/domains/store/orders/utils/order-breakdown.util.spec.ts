import {
  buildOrderLineBreakdown,
  buildOrderTotalsBreakdown,
} from './order-breakdown.util';

const inc = (amount: number) => ({
  tax_name: 'INC 8%',
  tax_rate: '0.08000',
  tax_type: 'inc',
  tax_amount: amount.toFixed(2),
});

describe('order-breakdown.util', () => {
  describe('buildOrderLineBreakdown', () => {
    it('línea con impuesto incluido y sin descuento: base + impuesto persistido', () => {
      // Captura de la orden 22748: 2 × 27.778 = 55.556 es la BASE; con INC
      // la línea vale 60.000.
      const line = buildOrderLineBreakdown({
        total_price: '55555.56',
        discount_amount: '0',
        order_item_taxes: [inc(4444.44)],
      });
      expect(line).toEqual({
        base: 55555.56,
        discount: 0,
        taxes: [
          { name: 'INC 8%', rate: 0.08, tax_type: 'inc', amount: 4444.44 },
        ],
        tax_total: 4444.44,
        total: 60000,
      });
    });

    it('línea con promo: total = base − descuento + impuesto recalculado', () => {
      const line = buildOrderLineBreakdown({
        total_price: '55555.56',
        discount_amount: '16666.67',
        order_item_taxes: [inc(3111.11)],
      });
      expect(line.discount).toBe(16666.67);
      expect(line.tax_total).toBe(3111.11);
      expect(line.total).toBe(42000);
    });

    it('línea vieja sin desglose: no inventa impuesto', () => {
      const line = buildOrderLineBreakdown({
        total_price: 30000,
        discount_amount: null,
        order_item_taxes: [],
      });
      expect(line.taxes).toEqual([]);
      expect(line.tax_total).toBe(0);
      expect(line.total).toBe(30000);
    });
  });

  describe('buildOrderTotalsBreakdown', () => {
    const pollo = {
      total_price: '54629.63',
      discount_amount: '0',
      cancelled_at: null,
      order_item_taxes: [inc(4370.37)],
    };
    const pinchos = {
      total_price: '55555.56',
      discount_amount: '16666.67',
      cancelled_at: null,
      order_item_taxes: [inc(3111.11)],
    };
    const gaseosa = {
      total_price: '10000.00',
      discount_amount: '0',
      cancelled_at: null,
      order_item_taxes: [inc(800)],
    };

    it('orden 22748 con promo: subtotal, descuento e INC suman 111.800 a centavo', () => {
      const totals = buildOrderTotalsBreakdown({
        discount_amount: '16666.67',
        tax_amount: '8281.48',
        shipping_cost: '0',
        tip_amount: null,
        grand_total: '111800.00',
        order_items: [pollo, pinchos, gaseosa],
      });
      expect(totals).toEqual({
        subtotal_base: 120185.19,
        discount: 16666.67,
        taxes: [
          { name: 'INC 8%', rate: 0.08, tax_type: 'inc', amount: 8281.48 },
        ],
        tax_total: 8281.48,
        shipping: 0,
        tip: 0,
        grand_total: 111800,
        reconciles: true,
      });
    });

    it('separa el impuesto por tipo y excluye las líneas canceladas', () => {
      const totals = buildOrderTotalsBreakdown({
        discount_amount: 0,
        tax_amount: 2700,
        shipping_cost: 5000,
        tip_amount: 1000,
        grand_total: 28700,
        order_items: [
          gaseosa,
          {
            total_price: 10000,
            discount_amount: 0,
            cancelled_at: null,
            order_item_taxes: [
              {
                tax_name: 'IVA 19%',
                tax_rate: 0.19,
                tax_type: 'vat',
                tax_amount: 1900,
              },
            ],
          },
          { ...pollo, cancelled_at: new Date() },
        ],
      });
      expect(totals.subtotal_base).toBe(20000);
      expect(totals.taxes.map((tax) => [tax.name, tax.amount])).toEqual([
        ['INC 8%', 800],
        ['IVA 19%', 1900],
      ]);
      expect(totals.reconciles).toBe(true);
    });

    it('orden vieja sin filas: una fila genérica con el impuesto persistido y total sin forzar', () => {
      const totals = buildOrderTotalsBreakdown({
        discount_amount: 0,
        tax_amount: 4789.92,
        shipping_cost: 0,
        tip_amount: 0,
        grand_total: 30000,
        order_items: [
          { total_price: 30000, cancelled_at: null, order_item_taxes: [] },
        ],
      });
      expect(totals.taxes).toEqual([
        { name: 'Impuesto', rate: null, tax_type: null, amount: 4789.92 },
      ]);
      expect(totals.grand_total).toBe(30000);
      expect(totals.reconciles).toBe(false);
    });
  });
});
