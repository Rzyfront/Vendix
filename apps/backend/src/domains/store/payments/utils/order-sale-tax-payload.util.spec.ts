import { buildOrderSaleTaxPayload } from './order-sale-tax-payload.util';

const cents = (n: number) => Math.round(n * 100);

/** Cuadre del asiento POS sin factura: DR caja = CR revenue + 414505 + impuestos. */
function balance(order: {
  subtotal_amount: number;
  discount_amount?: number;
  tax_amount: number;
  shipping_cost: number;
  grand_total: number;
}, payload: ReturnType<typeof buildOrderSaleTaxPayload>) {
  const debit = cents(order.grand_total) + cents(order.discount_amount ?? 0);
  const credit =
    cents(order.subtotal_amount) +
    cents(payload.shipping_amount) +
    payload.tax_breakdown.reduce((s, r) => s + cents(r.tax_amount), 0);
  return { debit, credit };
}

describe('buildOrderSaleTaxPayload', () => {
  it('sin copia del envío: salida idéntica a la histórica', () => {
    const payload = buildOrderSaleTaxPayload({
      product_tax_rows: [
        { tax_type: 'iva', tax_amount: 1900, tax_rate: 0.19, taxable_amount: 10000 },
      ],
      order: { tax_amount: 1900, shipping_cost: 5000, shipping_tax_amount: 0 },
    });
    expect(payload).toEqual({
      tax_amount: 1900,
      shipping_amount: 5000,
      tax_breakdown: [
        { tax_type: 'iva', tax_amount: 1900, tax_rate: 0.19, taxable_amount: 10000 },
      ],
    });
  });

  it('envío con INC 8 % incluido: flete neto, impuesto sumado y fila propia', () => {
    const order = {
      subtotal_amount: 10000,
      tax_amount: 800,
      shipping_cost: 15000,
      shipping_tax_type: 'inc',
      shipping_tax_rate: 0.08,
      shipping_tax_amount: 1111.11,
      grand_total: 10000 + 800 + 15000,
    };
    const payload = buildOrderSaleTaxPayload({
      product_tax_rows: [
        { tax_type: 'inc', tax_amount: 800, tax_rate: 0.08, taxable_amount: 10000 },
      ],
      order,
    });
    expect(payload.shipping_amount).toBe(13888.89);
    expect(payload.tax_amount).toBe(1911.11);
    expect(payload.tax_breakdown).toEqual([
      { tax_type: 'inc', tax_amount: 800, tax_rate: 0.08, taxable_amount: 10000 },
      { tax_type: 'inc', tax_amount: 1111.11, tax_rate: 0.08, taxable_amount: 13888.89 },
    ]);
    const { debit, credit } = balance(order, payload);
    expect(credit).toBe(debit);
  });

  it('IVA en el envío con productos INC: AR = revenue + 414505 + iva + inc', () => {
    const order = {
      subtotal_amount: 20000,
      discount_amount: 1000,
      tax_amount: 1600,
      shipping_cost: 15000,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 2394.96,
      grand_total: 20000 - 1000 + 1600 + 15000,
    };
    const payload = buildOrderSaleTaxPayload({
      product_tax_rows: [
        { tax_type: 'inc', tax_amount: 1600, tax_rate: 0.08, taxable_amount: 20000 },
      ],
      order,
    });
    expect(payload.shipping_amount).toBe(12605.04);
    const iva = payload.tax_breakdown.filter((r) => r.tax_type === 'iva');
    const inc = payload.tax_breakdown.filter((r) => r.tax_type === 'inc');
    expect(iva).toHaveLength(1);
    expect(iva[0].tax_amount).toBe(2394.96);
    expect(inc[0].tax_amount).toBe(1600);
    const { debit, credit } = balance(order, payload);
    expect(credit).toBe(debit);
  });

  it('productos sin filas tipadas pero con tax_amount: antepone fila iva para no perder el impuesto', () => {
    const order = {
      subtotal_amount: 10000,
      tax_amount: 1900,
      shipping_cost: 10800,
      shipping_tax_type: 'inc',
      shipping_tax_rate: 0.08,
      shipping_tax_amount: 800,
      grand_total: 10000 + 1900 + 10800,
    };
    const payload = buildOrderSaleTaxPayload({ product_tax_rows: [], order });
    expect(payload.tax_breakdown[0]).toEqual({ tax_type: 'iva', tax_amount: 1900 });
    const { debit, credit } = balance(order, payload);
    expect(credit).toBe(debit);
  });
});
