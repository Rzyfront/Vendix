import {
  adaptInvoiceOcrV2ToV1,
  InvoiceOcrV2Raw,
  isInvoiceOcrV2,
  toInvoiceOcrV2Shape,
} from './invoice-ocr-v2.adapter';

function v2(overrides: Partial<InvoiceOcrV2Raw> = {}): InvoiceOcrV2Raw {
  return {
    schema_version: 2,
    supplier: { name: 'COLANTA' },
    invoice_number: 'F-1',
    invoice_date: '2026-09-01',
    price_basis: 'sin_iva',
    line_items: [],
    discounts: [],
    printed_subtotal: null,
    printed_iva_total: null,
    printed_total: null,
    confidence: 90,
    ...overrides,
  };
}

const line = (o: Record<string, unknown> = {}) => ({
  description: 'X',
  quantity: 10,
  unit_price: 1000,
  discount: { kind: 'none' as const, value: 0 },
  taxes: [{ type: 'iva' as const, treatment: 'gravado' as const, rate: 19 }],
  printed_line_total: 11900,
  ...o,
});

describe('invoice-ocr-v2.adapter', () => {
  describe('isInvoiceOcrV2', () => {
    it('detecta schema_version 2 o descuento objeto en línea; v1 no', () => {
      expect(isInvoiceOcrV2({ schema_version: 2 })).toBe(true);
      expect(
        isInvoiceOcrV2({ line_items: [{ discount: { kind: 'none' } }] }),
      ).toBe(true);
      expect(
        isInvoiceOcrV2({ line_items: [{ discount_amount: 5, tax_rate: 0.19 }] }),
      ).toBe(false);
      expect(isInvoiceOcrV2(null)).toBe(false);
    });
  });

  describe('líneas', () => {
    it('descuento % por línea: percentage, sin monto, kind conservado', () => {
      const out = adaptInvoiceOcrV2ToV1(
        v2({ line_items: [line({ discount: { kind: 'percent', value: 10 } })] }),
      );
      const li = out.line_items[0];
      expect(li.discount_percentage).toBe(10);
      expect(li.discount_amount).toBe(0);
      expect(li.discount_kind).toBe('percent');
    });

    it('descuento $ por línea', () => {
      const li = adaptInvoiceOcrV2ToV1(
        v2({ line_items: [line({ discount: { kind: 'amount', value: 762 } })] }),
      ).line_items[0];
      expect(li.discount_amount).toBe(762);
      expect(li.discount_percentage).toBe(0);
      expect(li.discount_kind).toBe('amount');
    });

    it('precio con IVA vs sin IVA: inclusive según base; icui/ibua nunca inclusivos', () => {
      const con = adaptInvoiceOcrV2ToV1(
        v2({
          price_basis: 'con_iva',
          line_items: [
            line({
              taxes: [
                { type: 'iva', treatment: 'gravado', rate: 19 },
                { type: 'ibua', treatment: 'gravado', amount: 7140 },
              ],
            }),
          ],
        }),
      );
      expect(con.prices_include_tax).toBe(true);
      expect(con.line_items[0].taxes[0].inclusive).toBe(true);
      expect(con.line_items[0].taxes[1].inclusive).toBe(false);
      const sin = adaptInvoiceOcrV2ToV1(v2({ line_items: [line()] }));
      expect(sin.prices_include_tax).toBe(false);
      expect(sin.line_items[0].taxes[0].inclusive).toBe(false);
      expect(sin.line_items[0].tax_rate).toBeCloseTo(0.19);
    });

    it('línea con base distinta a la factura marca sus impuestos y la base de línea', () => {
      const li = adaptInvoiceOcrV2ToV1(
        v2({ line_items: [line({ price_basis: 'con_iva' })] }),
      ).line_items[0];
      expect(li.taxes[0].inclusive).toBe(true);
      expect(li.line_prices_include_tax).toBe(true);
    });

    it('exento y excluido: rate 0, tax_rate legacy 0 y tax_treatment', () => {
      for (const treatment of ['exento', 'excluido'] as const) {
        const li = adaptInvoiceOcrV2ToV1(
          v2({
            line_items: [
              line({ taxes: [{ type: 'iva', treatment, rate: 19 }] }),
            ],
          }),
        ).line_items[0];
        expect(li.taxes[0].rate).toBe(0);
        expect(li.tax_rate).toBe(0);
        expect(li.tax_treatment).toBe(treatment);
      }
    });

    it('sin fila IVA: tax_rate legacy null', () => {
      const li = adaptInvoiceOcrV2ToV1(
        v2({ line_items: [line({ taxes: [] })] }),
      ).line_items[0];
      expect(li.tax_rate).toBeNull();
    });

    it('bonificación: precio, total y descuentos en 0', () => {
      const li = adaptInvoiceOcrV2ToV1(
        v2({
          line_items: [
            line({
              is_bonus: true,
              discount: { kind: 'percent', value: 5 },
            }),
          ],
        }),
      ).line_items[0];
      expect(li.unit_price).toBe(0);
      expect(li.total).toBe(0);
      expect(li.discount_percentage).toBe(0);
      expect(li.is_bonus).toBe(true);
    });
  });

  describe('descuentos de pie', () => {
    it('% scope subtotal usa printed_subtotal', () => {
      const out = adaptInvoiceOcrV2ToV1(
        v2({
          printed_subtotal: 200000,
          printed_total: 238000,
          discounts: [
            { kind: 'percent', value: 5, scope: 'subtotal', is_early_payment: false },
          ],
        }),
      );
      expect(out.discount_amount).toBe(10000);
      expect(out.header_discount_percentage).toBe(5);
      expect(out.header_discount_kind).toBe('percent');
    });

    it('% scope total usa printed_total; sin base usa Σ líneas', () => {
      const a = adaptInvoiceOcrV2ToV1(
        v2({
          printed_total: 100000,
          discounts: [{ kind: 'percent', value: 10, scope: 'total' }],
        }),
      );
      expect(a.discount_amount).toBe(10000);
      const b = adaptInvoiceOcrV2ToV1(
        v2({
          line_items: [line({ discount: { kind: 'amount', value: 2000 } })],
          discounts: [{ kind: 'percent', value: 10, scope: 'subtotal' }],
        }),
      );
      expect(b.discount_amount).toBe(800); // (10000 - 2000) * 10 %
    });

    it('$ de pie: monto directo, kind amount', () => {
      const out = adaptInvoiceOcrV2ToV1(
        v2({ discounts: [{ kind: 'amount', value: 3000, scope: 'total' }] }),
      );
      expect(out.discount_amount).toBe(3000);
      expect(out.header_discount_kind).toBe('amount');
      expect(out.header_discount_percentage).toBeUndefined();
    });

    it('pronto pago en %: va a early_payment_discount, no al comercial; redondea a la moneda', () => {
      const out = adaptInvoiceOcrV2ToV1(
        v2({
          printed_total: 100001,
          discounts: [
            { kind: 'percent', value: 2, scope: 'total', is_early_payment: true },
          ],
        }),
        { decimalPlaces: 0 },
      );
      expect(out.early_payment_discount).toBe(2000);
      expect(out.discount_amount).toBeUndefined();
    });
  });

  describe('toInvoiceOcrV2Shape', () => {
    it('ida y vuelta conserva kind y valores por línea', () => {
      const original = v2({
        line_items: [
          line({ discount: { kind: 'percent', value: 12.5 } }),
          line({ discount: { kind: 'amount', value: 762 } }),
        ],
      });
      const v1 = adaptInvoiceOcrV2ToV1(original);
      const back = toInvoiceOcrV2Shape(v1);
      expect(back.schema_version).toBe(2);
      expect(back.line_items![0].discount).toMatchObject({
        kind: 'percent',
        value: 12.5,
      });
      expect(back.line_items![1].discount).toMatchObject({
        kind: 'amount',
        value: 762,
      });
      expect(back.line_items![0].taxes![0]).toMatchObject({
        type: 'iva',
        treatment: 'gravado',
        rate: 19,
      });
      expect(back.line_items![0].printed_line_total).toBe(11900);
    });

    it('conserva base propia de línea y exento', () => {
      const v1 = adaptInvoiceOcrV2ToV1(
        v2({
          line_items: [
            line({ price_basis: 'con_iva' }),
            line({ taxes: [{ type: 'iva', treatment: 'exento', rate: 0 }] }),
          ],
        }),
      );
      const back = toInvoiceOcrV2Shape(v1);
      expect(back.line_items![0].price_basis).toBe('con_iva');
      expect(back.line_items![1].taxes![0].treatment).toBe('exento');
    });

    it('acepta v1 crudo y descuentos de pie como monto', () => {
      const back = toInvoiceOcrV2Shape({
        supplier: { name: 'S' },
        prices_include_tax: true,
        discount_amount: 500,
        early_payment_discount: 100,
        total: 9000,
        line_items: [
          { description: 'a', quantity: 1, unit_price: 100, discount_amount: 5, tax_rate: 0.19, total: 100 },
        ],
      });
      expect(back.price_basis).toBe('con_iva');
      expect(back.line_items![0].discount).toMatchObject({ kind: 'amount', value: 5 });
      expect(back.line_items![0].taxes![0].rate).toBe(19);
      expect(back.discounts).toHaveLength(2);
      expect(back.printed_total).toBe(9000);
    });

    it('es idempotente sobre un v2 auténtico', () => {
      const original = v2({ line_items: [line()] });
      expect(toInvoiceOcrV2Shape(original as any)).toBe(original);
    });
  });
});
