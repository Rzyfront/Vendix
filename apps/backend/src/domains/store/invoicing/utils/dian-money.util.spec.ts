import { Prisma } from '@prisma/client';
import {
  dianAmount,
  dianArithmetic,
  dianRate,
  dianSum,
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
});
