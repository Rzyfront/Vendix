import {
  computePhoneFormatHint,
  PHONE_EXPECTED_LENGTH,
} from './phone-format-hint.util';

/**
 * QUI-723 — Unit tests for the phone-format-hint util.
 *
 * Pure-function tests (no TestBed). Run with `ng test` (Karma + Jasmine).
 *
 * Coverage map:
 *   - empty / whitespace / null / undefined input  → null
 *   - below 10 digits (1, 5, 9)                   → 'info' "Faltan N dígito(s)"
 *   - exactly 10 digits                            → 'ok' "✓ 10 dígitos"
 *   - over 10 digits (11, 14)                     → 'warn' "N dígito(s) de más"
 *   - non-digit characters (spaces, +, -, ())     → counted as digits-only
 *   - singular vs plural agreement
 *
 * Note: the util counts DIGITS in the input (not characters). A single
 * "3" is length=1, so the count display shows "1 / 10" and "Faltan 9".
 * Tests reflect this behavior.
 */
describe('computePhoneFormatHint', () => {
  it('returns null when the input is empty / null / undefined', () => {
    expect(computePhoneFormatHint('')).toBeNull();
    expect(computePhoneFormatHint('   ')).toBeNull();
    expect(computePhoneFormatHint(null)).toBeNull();
    expect(computePhoneFormatHint(undefined)).toBeNull();
  });

  it('returns null when only whitespace is typed', () => {
    expect(computePhoneFormatHint('\t\n')).toBeNull();
  });

  describe('below the target (info tone)', () => {
    it('shows "Faltan 9" for a single digit (length=1, missing=9)', () => {
      const hint = computePhoneFormatHint('3');
      expect(hint?.tone).toBe('info');
      expect(hint?.text).toContain('Faltan 9');
      expect(hint?.text).toContain('1 / 10');
    });

    it('shows "Faltan 5" when 5 digits are typed', () => {
      const hint = computePhoneFormatHint('30012');
      expect(hint?.tone).toBe('info');
      expect(hint?.text).toContain('Faltan 5');
      expect(hint?.text).toContain('5 / 10');
    });

    it('uses singular form when 1 digit is missing', () => {
      // 9 digits typed → length=9, missing=1 → singular "dígito"
      const hint = computePhoneFormatHint('300123456');
      expect(hint?.tone).toBe('info');
      expect(hint?.text).toContain('Faltan 1 dígito ');
      expect(hint?.text).not.toContain('Faltan 1 dígitos');
    });
  });

  describe('exactly 10 digits (ok tone)', () => {
    it('returns ok for plain 10-digit number', () => {
      const hint = computePhoneFormatHint('3001234567');
      expect(hint?.tone).toBe('ok');
      expect(hint?.text).toContain('✓ 10 dígitos');
      expect(hint?.text).toContain('listo para guardar');
    });

    it('counts digits-only when input has spaces + parens', () => {
      const hint = computePhoneFormatHint('(300) 123-4567');
      expect(hint?.tone).toBe('ok');
      expect(hint?.text).toContain('✓ 10 dígitos');
    });

    it('warns when Colombian country prefix is included (over 10 digits)', () => {
      // The hint counts ALL digits in the input — "+57 300 123 4567"
      // has 12 (573001234567) and is therefore over the 10-digit limit.
      // The hint copy explicitly tells the cashier to remove the country
      // prefix. This is intentional: we don't try to be clever about
      // stripping "+57" because there's no reliable way to know whether
      // any other leading digits are part of a prefix or a typo.
      const hint = computePhoneFormatHint('+57 300 123 4567');
      expect(hint?.tone).toBe('warn');
      expect(hint?.text).toContain('Quitá el prefijo de país');
    });

    it('exposes PHONE_EXPECTED_LENGTH as 10', () => {
      expect(PHONE_EXPECTED_LENGTH).toBe(10);
    });
  });

  describe('over the target (warn tone)', () => {
    it('shows "1 dígito de más" for 11 digits', () => {
      const hint = computePhoneFormatHint('30012345670');
      expect(hint?.tone).toBe('warn');
      expect(hint?.text).toContain('1 dígito de más');
      expect(hint?.text).toContain('máximo 10');
    });

    it('uses plural form when 4 digits over (14 digits typed)', () => {
      const hint = computePhoneFormatHint('30012345670000');
      expect(hint?.tone).toBe('warn');
      expect(hint?.text).toContain('4 dígitos de más');
    });

    it('hints to remove country prefix when over-length', () => {
      const hint = computePhoneFormatHint('+573001234567');
      expect(hint?.tone).toBe('warn');
      expect(hint?.text).toContain('Quitá el prefijo de país');
    });
  });

  it('ignores whitespace and edge cases', () => {
    // Empty after trim → null
    expect(computePhoneFormatHint('   ')).toBeNull();
    // Tab/newline → null
    expect(computePhoneFormatHint('\t\n')).toBeNull();
  });
});
