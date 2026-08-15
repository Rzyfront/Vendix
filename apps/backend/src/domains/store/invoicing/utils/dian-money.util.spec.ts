import { Prisma } from '@prisma/client';
import {
  clearInclusiveLine,
  dianAmount,
  dianArithmetic,
  dianLineExtension,
  dianLineGross,
  dianRate,
  dianSum,
  dianUnitPrice,
  toDecimal,
} from './dian-money.util';

describe('dian-money.util', () => {
  describe('dianAmount — scale', () => {
    it('pads a Decimal that lost its scale through toString()', () => {
      // This is the exact regression: Prisma.Decimal('1000.00').toString() is
      // '1000', which is what used to reach the CUFE while the XML got
      // '1000.00'.
      const decimal = new Prisma.Decimal('1000.00');
      expect(decimal.toString()).toBe('1000');
      expect(dianAmount(decimal)).toBe('1000.00');
    });

    it('pads whole-peso strings and numbers', () => {
      expect(dianAmount('1000')).toBe('1000.00');
      expect(dianAmount(1000)).toBe('1000.00');
      expect(dianAmount('119000')).toBe('119000.00');
    });

    it('keeps a single decimal padded to two', () => {
      expect(dianAmount('1000.5')).toBe('1000.50');
      expect(dianAmount(new Prisma.Decimal('1000.50'))).toBe('1000.50');
    });

    it('emits no thousands separator and no currency symbol', () => {
      expect(dianAmount('1234567.89')).toBe('1234567.89');
    });
  });

  describe('dianAmount — truncation (Anexo 1.9 §11.2)', () => {
    it('truncates instead of rounding', () => {
      expect(dianAmount('1000.005')).toBe('1000.00');
      expect(dianAmount('1000.009')).toBe('1000.00');
      expect(dianAmount('1000.999')).toBe('1000.99');
    });

    it('truncates without the float-multiplication trap', () => {
      // Math.trunc(1000.005 * 100) / 100 evaluates to 1000, losing the cents
      // entirely. Decimal-space truncation keeps them.
      expect(dianAmount(1000.005)).toBe('1000.00');
      expect(dianAmount(0.145)).toBe('0.14');
    });

    it('collapses sub-cent values to zero', () => {
      expect(dianAmount('0.001')).toBe('0.00');
      expect(dianAmount('0.009')).toBe('0.00');
    });

    it('normalizes negative zero so the CUFE hash is stable', () => {
      expect(dianAmount('-0.001')).toBe('0.00');
      expect(dianAmount(-0.004)).toBe('0.00');
    });

    it('keeps real negatives signed', () => {
      expect(dianAmount('-150.50')).toBe('-150.50');
    });
  });

  describe('dianAmount — defensive input', () => {
    it('maps absent values to 0.00 instead of NaN', () => {
      expect(dianAmount(null)).toBe('0.00');
      expect(dianAmount(undefined)).toBe('0.00');
      expect(dianAmount('')).toBe('0.00');
    });

    it('maps unparseable values to 0.00 rather than poisoning the hash', () => {
      expect(dianAmount('not-a-number')).toBe('0.00');
      expect(dianAmount(Number.NaN)).toBe('0.00');
      expect(dianAmount(Number.POSITIVE_INFINITY)).toBe('0.00');
    });
  });

  describe('dianRate', () => {
    it('pads a Decimal(5,2) rate that serialized without decimals', () => {
      const rate = new Prisma.Decimal('19.00');
      expect(rate.toString()).toBe('19');
      expect(dianRate(rate)).toBe('19.00');
    });

    it('formats fractional rates', () => {
      expect(dianRate('5')).toBe('5.00');
      expect(dianRate('8.5')).toBe('8.50');
      expect(dianRate(0)).toBe('0.00');
    });
  });

  describe('dianSum', () => {
    it('sums line amounts in Decimal space', () => {
      expect(dianSum(['100.00', '200.50', '0.50'])).toBe('301.00');
    });

    it('does not drift a cent on repeated thirds', () => {
      expect(dianSum(['0.33', '0.33', '0.34'])).toBe('1.00');
    });

    it('accepts Decimals that lost their scale', () => {
      expect(
        dianSum([new Prisma.Decimal('1000.00'), new Prisma.Decimal('500.00')]),
      ).toBe('1500.00');
    });

    it('returns 0.00 for an empty set', () => {
      expect(dianSum([])).toBe('0.00');
    });
  });

  describe('dianArithmetic', () => {
    it('computes subtotal - discount + tax without intermediate rounding', () => {
      const result = dianArithmetic([
        { value: '1000.00', sign: 1 },
        { value: '100.00', sign: -1 },
        { value: '171.00', sign: 1 },
      ]);
      expect(result).toBe('1071.00');
    });
  });

  describe('toDecimal', () => {
    it('returns a usable Decimal for further math', () => {
      expect(toDecimal('10.5').plus(toDecimal('0.5')).toFixed(2)).toBe('11.00');
    });

    it('collapses invalid input to zero', () => {
      expect(toDecimal('garbage').isZero()).toBe(true);
      expect(toDecimal(null).isZero()).toBe(true);
    });
  });

  /**
   * Recompone la regla de rechazo FAV06 (Anexo 1.9, pág. 443-444) sobre los
   * MISMOS strings que viajan en el XML:
   *
   *   cbc:LineExtensionAmount == PriceAmount × InvoicedQuantity ÷ BaseQuantity
   *                              − Σ AllowanceCharge[ChargeIndicator=false]
   *
   * Se recalcula desde el precio ya formateado, no desde el `Decimal` original,
   * porque es exactamente lo que hace la DIAN: recomputa el documento sobre los
   * importes que RECIBE, no sobre la precisión que los originó.
   */
  const emitFav06 = (
    line: Parameters<typeof dianLineExtension>[0],
    cleared: ReturnType<typeof clearInclusiveLine>,
  ) => {
    const emitted = {
      quantity: line.quantity,
      unit_price: dianUnitPrice(cleared ? cleared.unit_price : line.unit_price),
      discount_amount: dianAmount(
        cleared ? cleared.discount_amount : line.discount_amount,
      ),
      price_unit_quantity: line.price_unit_quantity,
    };
    return {
      price_amount: emitted.unit_price,
      allowance_amount: emitted.discount_amount,
      allowance_base: dianLineGross(emitted),
      line_extension: dianLineExtension(emitted),
    };
  };

  describe('clearInclusiveLine — FAV06 sobre precios impuesto-incluido', () => {
    it('despeja el caso de una unidad a $1.000 con IVA 19 % dentro', () => {
      const line = { quantity: 1, unit_price: 1000, discount_amount: 0 };
      const cleared = clearInclusiveLine({ ...line, taxable_base: '840.34' });

      const emitted = emitFav06(line, cleared);
      expect(emitted.price_amount).toBe('840.34');
      // Sin el despeje esto valía 1000.00 y la cabecera declaraba 840.34: el
      // descuadre que dejaba a toda tienda con precio inclusivo sin facturar.
      expect(emitted.line_extension).toBe('840.34');
    });

    it('usa los 6 decimales de PriceAmount cuando 2 no reproducen la base', () => {
      // 3 × 1.000 inclusivos ⇒ base persistida 2.521,01. Un precio truncado a
      // 840.33 da 2520.99: un centavo menos que la base que la cabecera declara,
      // y FAU14 deja de cuadrar en el documento entero.
      const line = { quantity: 3, unit_price: 1000, discount_amount: 0 };
      const cleared = clearInclusiveLine({ ...line, taxable_base: '2521.01' });

      const emitted = emitFav06(line, cleared);
      expect(emitted.price_amount).toBe('840.336667');
      expect(emitted.line_extension).toBe('2521.01');
    });

    it('despeja el descuento en la misma proporción y cuadra su allowance', () => {
      // Bruto 1.000, descuento 100 ⇒ neto inclusivo 900 ⇒ base 756,30.
      const line = { quantity: 1, unit_price: 1000, discount_amount: 100 };
      const cleared = clearInclusiveLine({ ...line, taxable_base: '756.30' });

      const emitted = emitFav06(line, cleared);
      expect(emitted.line_extension).toBe('756.30');
      expect(emitted.allowance_amount).toBe('84.03');
      // FAV06 al pie de la letra: base del descuento − descuento == neto.
      expect(
        toDecimal(emitted.allowance_base)
          .minus(toDecimal(emitted.allowance_amount))
          .toFixed(2),
      ).toBe('756.30');
    });

    it('respeta la price unit: el precio por kilo no se cobra por gramo', () => {
      // QUI-648: $28.000 el kilo, stock en gramos, se venden 2.500 g.
      const line = {
        quantity: 2500,
        unit_price: 28000,
        discount_amount: 0,
        price_unit_quantity: '1000',
      };
      expect(dianLineExtension(line)).toBe('70000.00');

      const cleared = clearInclusiveLine({ ...line, taxable_base: '58823.53' });
      expect(emitFav06(line, cleared).line_extension).toBe('58823.53');
    });

    it('devuelve null en vez de inventar un precio cuando la base no sirve', () => {
      const base = { quantity: 1, unit_price: 1000, discount_amount: 0 };
      // Cada uno es una factura que NO debe emitirse despejada: la línea sale
      // como siempre y el prevalidador la frena antes de gastar consecutivo.
      expect(clearInclusiveLine({ ...base, quantity: 0, taxable_base: '840.34' })).toBeNull();
      expect(clearInclusiveLine({ ...base, quantity: -1, taxable_base: '840.34' })).toBeNull();
      expect(clearInclusiveLine({ ...base, taxable_base: '1200.00' })).toBeNull();
      expect(clearInclusiveLine({ ...base, taxable_base: '0' })).toBeNull();
      expect(clearInclusiveLine({ ...base, unit_price: 0, taxable_base: '10.00' })).toBeNull();
    });
  });

  describe('dianUnitPrice', () => {
    it('mantiene 2 decimales cuando bastan, para no mover el histórico', () => {
      expect(dianUnitPrice('1500.00')).toBe('1500.00');
      expect(dianUnitPrice(1500)).toBe('1500.00');
      expect(dianUnitPrice(new Prisma.Decimal('840.34'))).toBe('840.34');
    });

    it('abre a 6 decimales sólo cuando 2 perderían precisión', () => {
      expect(dianUnitPrice('840.336667')).toBe('840.336667');
    });
  });

  describe('dianLineGross', () => {
    it('divide por la price unit, igual que el importe neto', () => {
      // Escrito a mano como cantidad × precio, el BaseAmount del descuento
      // salía 1.000 veces mayor que el LineExtensionAmount de su propia línea.
      const line = {
        quantity: 2500,
        unit_price: 28000,
        discount_amount: 100,
        price_unit_quantity: '1000',
      };
      expect(dianLineGross(line)).toBe('70000.00');
      expect(dianLineExtension(line)).toBe('69900.00');
    });
  });
});
