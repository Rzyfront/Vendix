import { Prisma } from '@prisma/client';
import {
  orderHasIncLines,
  resolveShippingInc,
  type ShippingIncOrderLine,
} from './shipping-inc.util';

/**
 * Matriz del predicado «el domicilio lleva INC incluido» (restaurante O-33).
 * Los importes esperados son LITERALES calculados a mano:
 *   15.000 / 1,08 = 13.888,888… ⇒ base 13.888,89 + INC 1.111,11 = 15.000
 *    5.000 / 1,08 =  4.629,629… ⇒ base  4.629,63 + INC   370,37 =  5.000
 */
describe('resolveShippingInc', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const inc = (
    overrides: Record<string, unknown> = {},
  ): NonNullable<ShippingIncOrderLine['order_item_taxes']>[number] => ({
    tax_rate_id: 68,
    tax_name: 'INC',
    tax_rate: money('0.08'),
    tax_amount: money('4000'),
    tax_type: 'inc',
    is_inclusive: true,
    ...overrides,
  });
  const line = (
    total_price: number,
    taxes: ShippingIncOrderLine['order_item_taxes'],
  ): ShippingIncOrderLine => ({
    total_price: money(total_price),
    order_item_taxes: taxes,
  });
  const base = {
    shipping_cost: money(15000),
    inc_responsible: true,
    is_restaurant: true,
    order_items: [line(50000, [inc()])],
  };

  describe('no aplica', () => {
    it('sin envío', () => {
      expect(resolveShippingInc({ ...base, shipping_cost: 0 })).toEqual({
        applies: false,
        reason: 'no_shipping',
      });
      expect(resolveShippingInc({ ...base, shipping_cost: null })).toEqual({
        applies: false,
        reason: 'no_shipping',
      });
    });

    it('emisor O-48 sin O-33 (no responsable de INC)', () => {
      expect(resolveShippingInc({ ...base, inc_responsible: false })).toEqual({
        applies: false,
        reason: 'not_inc_responsible',
      });
    });

    it('emisor O-33 que no es restaurante', () => {
      expect(resolveShippingInc({ ...base, is_restaurant: false })).toEqual({
        applies: false,
        reason: 'not_restaurant',
      });
    });

    it('sin líneas INC (sólo IVA, o exentas)', () => {
      const iva = inc({ tax_type: 'iva', tax_rate: money('0.19'), tax_rate_id: 1 });
      expect(
        resolveShippingInc({
          ...base,
          order_items: [line(50000, [iva]), line(1000, [])],
        }),
      ).toEqual({ applies: false, reason: 'no_inc_lines' });
      expect(resolveShippingInc({ ...base, order_items: [] })).toEqual({
        applies: false,
        reason: 'no_inc_lines',
      });
    });

    it('INC con cuota 0 no cuenta como línea gravada', () => {
      expect(
        resolveShippingInc({
          ...base,
          order_items: [line(50000, [inc({ tax_amount: money(0) })])],
        }),
      ).toEqual({ applies: false, reason: 'no_inc_lines' });
    });

    it('dos tarifas INC distintas ⇒ ambiguous_inc_rate (no se inventa)', () => {
      expect(
        resolveShippingInc({
          ...base,
          order_items: [
            line(50000, [inc()]),
            line(20000, [
              inc({ tax_rate_id: 69, tax_rate: money('0.04'), tax_amount: money(800) }),
            ]),
          ],
        }),
      ).toEqual({ applies: false, reason: 'ambiguous_inc_rate' });
    });
  });

  describe('aplica', () => {
    it('15.000 ⇒ base 13.888,89 + INC 1.111,11', () => {
      const result = resolveShippingInc(base);
      expect(result).toEqual({
        applies: true,
        gross: 15000,
        base: 13888.89,
        inc_amount: 1111.11,
        rate_fraction: 0.08,
        tax_row: {
          tax_rate_id: 68,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 13888.89,
          tax_amount: 1111.11,
          tax_type: 'inc',
          is_inclusive: true,
        },
      });
    });

    it('5.000 ⇒ base 4.629,63 + INC 370,37', () => {
      const result = resolveShippingInc({ ...base, shipping_cost: '5000' });
      expect(result).toMatchObject({
        applies: true,
        gross: 5000,
        base: 4629.63,
        inc_amount: 370.37,
      });
    });

    it('mismo porcentaje con dos tax_rate_id ⇒ gana el de mayor base', () => {
      const result = resolveShippingInc({
        ...base,
        order_items: [
          line(10000, [inc({ tax_rate_id: 5, tax_name: 'INC A' })]),
          line(30000, [inc({ tax_rate_id: 9, tax_name: 'INC B' })]),
          line(15000, [inc({ tax_rate_id: 5, tax_name: 'INC A' })]),
        ],
      });
      // id 9 = 30.000 > id 5 = 25.000
      expect(result.applies && result.tax_row).toMatchObject({
        tax_rate_id: 9,
        tax_name: 'INC B',
      });
    });

    it('empate de base ⇒ gana el tax_rate_id menor', () => {
      const result = resolveShippingInc({
        ...base,
        order_items: [
          line(10000, [inc({ tax_rate_id: 12, tax_name: 'INC doce' })]),
          line(10000, [inc({ tax_rate_id: 4, tax_name: 'INC cuatro' })]),
        ],
      });
      expect(result.applies && result.tax_row.tax_rate_id).toBe(4);
    });

    it('la fila copia el is_inclusive de la fila INC de origen', () => {
      const result = resolveShippingInc({
        ...base,
        order_items: [line(50000, [inc({ is_inclusive: false })])],
      });
      expect(result.applies && result.tax_row.is_inclusive).toBe(false);
    });
  });

  it('orderHasIncLines = P4', () => {
    expect(orderHasIncLines(base.order_items)).toBe(true);
    expect(orderHasIncLines([line(1, [inc({ tax_amount: 0 })])])).toBe(false);
    expect(orderHasIncLines(null)).toBe(false);
  });
});
