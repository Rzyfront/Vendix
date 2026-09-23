import { Logger } from '@nestjs/common';
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
      discount_amount: 0,
      discount_projected: false,
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

  describe('descuento de orden (misma proyección que la factura)', () => {
    // Caso de invoicing.service.order-discount.spec.ts:
    // Camisa 2×50.000 + IVA 19 % · Licor 100.000 + INC 8 % · Libro exento 20.000
    // · envío 5.000 (4.201,69 + IVA 798,31) · descuento 10.000 ⇒ 242.000.
    const items = () => [
      {
        quantity: 2,
        total_price: 100000,
        tax_amount_item: 9500,
        order_item_taxes: [{ tax_type: 'iva', tax_rate: 0.19, tax_amount: 19000 }],
      },
      {
        quantity: 1,
        total_price: 100000,
        tax_amount_item: 8000,
        order_item_taxes: [{ tax_type: 'inc', tax_rate: 0.08, tax_amount: 8000 }],
      },
      { quantity: 1, total_price: 20000, tax_amount_item: 0, order_item_taxes: [] },
    ];
    const order = {
      subtotal_amount: 220000,
      tax_amount: 27000,
      discount_amount: 10000,
      grand_total: 242000,
      shipping_cost: 5000,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 798.31,
    };
    const product_tax_rows = items().flatMap((item) =>
      item.order_item_taxes.map((t) => ({ ...t, taxable_amount: item.total_price })),
    );

    it('IVA/INC netos del descuento = los de la factura; 4175 sólo la parte de base; cuadra al centavo', () => {
      const payload = buildOrderSaleTaxPayload({
        product_tax_rows,
        order,
        order_items: items(),
      });
      expect(payload.discount_projected).toBe(true);
      const byType = (type: string) =>
        payload.tax_breakdown
          .filter((r) => r.tax_type === type)
          .reduce((s, r) => s + cents(r.tax_amount), 0);
      // Factura: IVA 18.230,76 (+ envío 798,31) · INC 7.676,11.
      expect(byType('iva')).toBe(cents(18230.76) + cents(798.31));
      expect(byType('inc')).toBe(cents(7676.11));
      expect(cents(payload.tax_amount)).toBe(cents(25906.87) + cents(798.31));
      // 10.000 − (27.000 − 25.906,87) = 8.906,87 de base.
      expect(cents(payload.discount_amount)).toBe(cents(8906.87));
      expect(cents(payload.shipping_amount)).toBe(cents(4201.69));
      const { debit, credit } = balance(
        { ...order, discount_amount: payload.discount_amount },
        payload,
      );
      expect(credit).toBe(debit);
    });

    it('sin descuento de orden: salida idéntica aunque lleguen las líneas', () => {
      const without = { ...order, discount_amount: 0, grand_total: 252000 };
      expect(
        buildOrderSaleTaxPayload({ product_tax_rows, order: without, order_items: items() }),
      ).toEqual(buildOrderSaleTaxPayload({ product_tax_rows, order: without }));
    });

    it('orden que no reconcilia con sus líneas: payload histórico y aviso sin PII', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const broken = { ...order, id: 5928, tax_amount: 26000 };
      const payload = buildOrderSaleTaxPayload({
        product_tax_rows,
        order: broken,
        order_items: items(),
      });
      expect(payload.discount_projected).toBe(false);
      expect(payload.discount_amount).toBe(10000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('no_reconcilia');
      expect(warn.mock.calls[0][0]).toContain('"id":5928');
      warn.mockRestore();
    });

    it('sin descuento no avisa', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      buildOrderSaleTaxPayload({
        product_tax_rows,
        order: { ...order, discount_amount: 0 },
        order_items: items(),
      });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
