import {
  buildCurrencyInstruction,
  checkTotalsConsistency,
  repairScannedAmount,
  StoreCurrencyInfo,
} from './ocr-money.util';

const COP: StoreCurrencyInfo = { code: 'COP', decimal_places: 0 };
const USD: StoreCurrencyInfo = { code: 'USD', decimal_places: 2 };

describe('repairScannedAmount', () => {
  describe('zero-decimal currency (COP)', () => {
    // Values taken verbatim from the Jerónimo Martins (Ara) receipt that
    // reproduced the bug: the model read the thousands separator as a decimal
    // point, so "24.990" arrived as 24.99.
    it.each([
      [24.99, 24990], // "24.990"
      [6.59, 6590], // "6.590"
      [49.99, 49990], // "49.990"
      [1.985, 1985], // "1.985"
      [2.989, 2989], // "2.989"
      [22.98, 22980], // "22.980"
      [371.404, 371404], // grand total "371.404"
    ])('repairs %p to %p', (input, expected) => {
      const result = repairScannedAmount(input, COP);
      expect(result.repaired).toBe(true);
      expect(result.value).toBe(expected);
    });

    it('recovers a multi-group misread in two hops', () => {
      // "1.234.567" collapsed to 1.234567 by the model.
      expect(repairScannedAmount(1.234567, COP)).toEqual({
        value: 1234567,
        repaired: true,
      });
    });

    it('leaves correctly-read integers untouched', () => {
      expect(repairScannedAmount(24990, COP)).toEqual({
        value: 24990,
        repaired: false,
      });
    });

    it('leaves zero untouched', () => {
      expect(repairScannedAmount(0, COP)).toEqual({
        value: 0,
        repaired: false,
      });
    });

    it('leaves a genuine division result untouched', () => {
      // `unit_price = total / quantity` — the model divided instead of
      // reading. 10000/3 serializes with 16 decimals, far past the 9 a
      // collapsed separator can produce, so the guard declines to touch it.
      // This is the case that makes the repair safe to run unconditionally.
      const divided = 10000 / 3;
      const result = repairScannedAmount(divided, COP);
      expect(result.repaired).toBe(false);
      expect(result.value).toBe(divided);
    });

    it('leaves a value with more than 3 collapsed groups untouched', () => {
      expect(repairScannedAmount(1.2345678901, COP).repaired).toBe(false);
    });

    it('leaves non-finite input untouched', () => {
      expect(repairScannedAmount(NaN, COP).repaired).toBe(false);
    });
  });

  describe('decimal currency (USD)', () => {
    it('never repairs — 24.99 USD is a real price', () => {
      expect(repairScannedAmount(24.99, USD)).toEqual({
        value: 24.99,
        repaired: false,
      });
    });
  });
});

describe('buildCurrencyInstruction', () => {
  it('spells out the thousands-separator rule for zero-decimal currencies', () => {
    const text = buildCurrencyInstruction(COP);
    expect(text).toContain('COP');
    expect(text).toContain('THOUSANDS separator');
    expect(text).toContain('24990');
  });

  it('omits the separator rule for decimal currencies', () => {
    const text = buildCurrencyInstruction(USD);
    expect(text).toContain('USD');
    expect(text).toContain('2 decimal place(s)');
    expect(text).not.toContain('THOUSANDS separator');
  });
});

describe('checkTotalsConsistency', () => {
  it('returns null when the lines add up', () => {
    expect(checkTotalsConsistency([24990, 6590, 49990], 81570, 'COP')).toBeNull();
  });

  it('tolerates a small discount gap', () => {
    // Ara receipt: 371404 in lines, 369414 payable after a 1990 discount.
    expect(checkTotalsConsistency([371404], 369414, 'COP')).toBeNull();
  });

  it('flags a 1000x mismatch', () => {
    const warning = checkTotalsConsistency([24.99, 6.59], 31580, 'COP');
    expect(warning).toContain('no coincide');
  });

  it('returns null when there is nothing to compare', () => {
    expect(checkTotalsConsistency([], 1000, 'COP')).toBeNull();
    expect(checkTotalsConsistency([100], 0, 'COP')).toBeNull();
  });
});
