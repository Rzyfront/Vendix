import { computeNitDv, normalizeNit, onlyDigits } from './nit.util';

describe('nit.util', () => {
  describe('computeNitDv', () => {
    // Reference values from the DIAN modulo-11 algorithm.
    it.each([
      ['900123456', '8'],
      ['830053105', '3'],
      ['800197268', '4'],
      ['901234567', '7'],
    ])('derives the DV of %s as %s', (nit, expected) => {
      expect(computeNitDv(nit)).toBe(expected);
    });

    it('ignores separators before computing', () => {
      expect(computeNitDv('900.123.456')).toBe(computeNitDv('900123456'));
      expect(computeNitDv(' 900 123 456 ')).toBe(computeNitDv('900123456'));
    });

    it('returns empty string when there is no NIT at all', () => {
      // Distinguishable from the perfectly valid DV '0'.
      expect(computeNitDv('')).toBe('');
      expect(computeNitDv(null)).toBe('');
      expect(computeNitDv(undefined)).toBe('');
      expect(computeNitDv('abc')).toBe('');
    });
  });

  describe('normalizeNit', () => {
    it('splits a hyphenated NIT whose DV already agrees', () => {
      expect(normalizeNit('900123456-8')).toEqual({
        number: '900123456',
        dv: '8',
        provided_dv: '8',
        dv_mismatch: false,
      });
    });

    it('overrides a stored DV that disagrees, and says so', () => {
      // Real case: the dev seed holds `800987654-3`, but the modulo-11 DV of
      // 800987654 is 4. Trusting the stored digit would put a NIT/DV pair on
      // the invoice that DIAN cannot match to any taxpayer.
      expect(normalizeNit('800987654-3')).toEqual({
        number: '800987654',
        dv: '4',
        provided_dv: '3',
        dv_mismatch: true,
      });
    });

    it('ignores a multi-digit tail as noise', () => {
      expect(normalizeNit('900123456-88')).toEqual({
        number: '900123456',
        dv: '8',
        provided_dv: null,
        dv_mismatch: false,
      });
    });

    it('computes the DV when the input has none', () => {
      expect(normalizeNit('900.123.456')).toEqual({
        number: '900123456',
        dv: '8',
        provided_dv: null,
        dv_mismatch: false,
      });
    });

    it('returns empties for a blank input', () => {
      expect(normalizeNit('   ')).toEqual({
        number: '',
        dv: '',
        provided_dv: null,
        dv_mismatch: false,
      });
      expect(normalizeNit(null)).toEqual({
        number: '',
        dv: '',
        provided_dv: null,
        dv_mismatch: false,
      });
    });
  });

  describe('onlyDigits', () => {
    it('strips everything that is not a digit', () => {
      expect(onlyDigits('900.123.456-3')).toBe('9001234563');
      expect(onlyDigits(null)).toBe('');
    });
  });
});
