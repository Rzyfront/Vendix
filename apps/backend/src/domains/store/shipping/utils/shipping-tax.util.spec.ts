import {
  EMPTY_SHIPPING_TAX,
  buildShippingTaxBreakdownRow,
  evaluateShippingTaxCategory,
  resolveShippingTaxSnapshot,
  shippingNetBase,
} from './shipping-tax.util';

const inc8 = {
  id: 7,
  name: 'INC 8%',
  tax_type: 'inc',
  tax_rates: [{ id: 70, name: 'INC 8%', rate: '0.08000' }],
};
const iva19 = {
  id: 3,
  name: 'IVA 19%',
  tax_type: 'iva',
  tax_rates: [{ id: 30, name: 'IVA 19%', rate: 0.19 }],
};

describe('shipping-tax.util', () => {
  describe('resolveShippingTaxSnapshot', () => {
    it('15.000 con INC 8 % ⇒ base 13.888,89 + INC 1.111,11 (bruto intacto)', () => {
      const r = resolveShippingTaxSnapshot({ shipping_cost: 15000, category: inc8 });
      expect(r.applies).toBe(true);
      if (!r.applies) return;
      expect(r.base).toBe(13888.89);
      expect(r.gross).toBe(15000);
      expect(r.snapshot).toEqual({
        shipping_tax_rate_id: 70,
        shipping_tax_name: 'INC 8%',
        shipping_tax_type: 'inc',
        shipping_tax_rate: 0.08,
        shipping_tax_amount: 1111.11,
      });
      expect(Math.round(r.base * 100) + Math.round(r.snapshot.shipping_tax_amount * 100)).toBe(1500000);
    });

    // Kernel DIAN (truncado + bump): 12.605,05 × 0,19 = 2.394,9595 ⇒ 2.394,95.
    // (Con redondeo en vez de truncado saldría 12.605,04 + 2.394,96.)
    it('15.000 con IVA 19 % ⇒ base 12.605,05 + IVA 2.394,95 (truncado DIAN)', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: '15000.00',
        category: iva19,
        vat_responsible: true,
      });
      expect(r.applies).toBe(true);
      if (!r.applies) return;
      expect(r.base).toBe(12605.05);
      expect(r.snapshot.shipping_tax_amount).toBe(2394.95);
      expect(r.snapshot.shipping_tax_type).toBe('iva');
    });

    it('ignora is_inclusive de la categoría: siempre incluido', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: 15000,
        category: { ...inc8, is_inclusive: false } as any,
      });
      expect(r.applies && r.base + r.snapshot.shipping_tax_amount).toBe(15000);
    });

    it('categoría sin tipo se resuelve como IVA en la fila de origen', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: 15000,
        category: { ...iva19, tax_type: null },
      });
      expect(r.applies && r.snapshot.shipping_tax_type).toBe('iva');
    });

    it('bruto inalcanzable al centavo (10.000 con IVA 19 %) ⇒ vacía, no mueve lo que paga el cliente', () => {
      // 8.403,36 + 1.596,63 = 9.999,99 y 8.403,37 + 1.596,64 = 10.000,01.
      const r = resolveShippingTaxSnapshot({ shipping_cost: 10000, category: iva19 });
      expect(r).toEqual({
        applies: false,
        reason: 'clearing_unclosed',
        snapshot: EMPTY_SHIPPING_TAX,
      });
    });

    it.each([
      [0, 'no_shipping'],
      [null, 'no_shipping'],
      [-5, 'no_shipping'],
      ['abc', 'no_shipping'],
    ])('costo %p ⇒ copia vacía (%s)', (cost, reason) => {
      const r = resolveShippingTaxSnapshot({ shipping_cost: cost, category: inc8 });
      expect(r).toEqual({ applies: false, reason, snapshot: EMPTY_SHIPPING_TAX });
    });

    it('sin categoría ⇒ copia vacía', () => {
      const r = resolveShippingTaxSnapshot({ shipping_cost: 15000, category: null });
      expect(r.applies).toBe(false);
      expect(r.snapshot).toEqual(EMPTY_SHIPPING_TAX);
    });

    it('IVA con emisor no responsable ⇒ copia vacía', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: 15000,
        category: iva19,
        vat_responsible: false,
      });
      expect(r).toMatchObject({ applies: false, reason: 'vat_not_responsible' });
    });

    it('INC no depende de la responsabilidad de IVA', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: 15000,
        category: inc8,
        vat_responsible: false,
      });
      expect(r.applies).toBe(true);
    });

    it('categoría con varias tarifas > 0 ⇒ vacía', () => {
      const r = resolveShippingTaxSnapshot({
        shipping_cost: 15000,
        category: {
          ...iva19,
          tax_rates: [
            { id: 1, name: 'a', rate: 0.19 },
            { id: 2, name: 'b', rate: 0.05 },
          ],
        },
      });
      expect(r).toMatchObject({ applies: false, reason: 'multiple_positive_rates' });
    });

    it('la copia vacía devuelta no es la constante compartida (sin mutación por referencia)', () => {
      const r = resolveShippingTaxSnapshot({ shipping_cost: 0, category: inc8 });
      expect(r.snapshot).not.toBe(EMPTY_SHIPPING_TAX);
      expect(Object.isFrozen(EMPTY_SHIPPING_TAX)).toBe(true);
    });

    it('cierre al centavo en montos con decimales', () => {
      for (const cost of [0.01, 1, 999.99, 4500, 12345.67, 87000]) {
        for (const cat of [inc8, iva19]) {
          const r = resolveShippingTaxSnapshot({ shipping_cost: cost, category: cat });
          if (!r.applies) {
            expect(r.snapshot).toEqual(EMPTY_SHIPPING_TAX);
            continue;
          }
          expect(
            Math.round(r.base * 100) + Math.round(r.snapshot.shipping_tax_amount * 100),
          ).toBe(Math.round(cost * 100));
        }
      }
    });
  });

  describe('evaluateShippingTaxCategory', () => {
    it('elegible con una sola tarifa > 0 (ignora las de 0 %)', () => {
      const e = evaluateShippingTaxCategory({
        ...inc8,
        tax_rates: [
          { id: 1, name: 'cero', rate: 0 },
          { id: 70, name: 'INC 8%', rate: 0.08 },
        ],
      });
      expect(e).toMatchObject({ eligible: true, tax_type: 'inc', rate_percent: 8 });
    });

    it.each(['ica', 'withholding', 'reteiva', 'reteica'])('tipo %s ⇒ no elegible', (t) => {
      const e = evaluateShippingTaxCategory({ ...iva19, tax_type: t });
      expect(e).toMatchObject({ eligible: false, reason_code: 'unsupported_tax_type' });
    });

    it('sin tarifa > 0 ⇒ no elegible', () => {
      const e = evaluateShippingTaxCategory({ ...iva19, tax_rates: [{ id: 1, rate: 0 }] });
      expect(e).toMatchObject({ eligible: false, reason_code: 'no_positive_rate' });
    });

    it('tarifa >= 1 (porcentaje mal guardado) ⇒ no elegible', () => {
      const e = evaluateShippingTaxCategory({ ...iva19, tax_rates: [{ id: 1, rate: 19 }] });
      expect(e).toMatchObject({ eligible: false, reason_code: 'rate_out_of_range' });
    });
  });

  describe('buildShippingTaxBreakdownRow / shippingNetBase', () => {
    it('arma la fila desde la copia de la orden (tarifa en fracción, base neta)', () => {
      const order = {
        shipping_cost: '15000.00',
        shipping_tax_type: 'inc',
        shipping_tax_rate: '0.08000',
        shipping_tax_amount: '1111.11',
      };
      expect(buildShippingTaxBreakdownRow(order)).toEqual({
        tax_type: 'inc',
        tax_amount: 1111.11,
        tax_rate: 0.08,
        taxable_amount: 13888.89,
      });
      expect(shippingNetBase(order)).toBe(13888.89);
    });

    it('sin copia ⇒ null y base = costo bruto', () => {
      const order = { shipping_cost: 15000, shipping_tax_amount: 0 };
      expect(buildShippingTaxBreakdownRow(order)).toBeNull();
      expect(buildShippingTaxBreakdownRow(null)).toBeNull();
      expect(shippingNetBase(order)).toBe(15000);
    });
  });
});
