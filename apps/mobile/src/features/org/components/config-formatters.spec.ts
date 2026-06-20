import {
  BRANDING_DEFAULTS,
  mergeBrandingDefaults,
  isValidHex,
  normalizeHex,
  paymentStateBadge,
  formatAmountRange,
  summarizePaymentStats,
  brandingName,
} from './config-formatters';

describe('config-formatters', () => {
  describe('BRANDING_DEFAULTS', () => {
    it('exposes sensible defaults', () => {
      expect(BRANDING_DEFAULTS.name).toBeTruthy();
      expect(BRANDING_DEFAULTS.primary_color).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe('mergeBrandingDefaults', () => {
    it('returns defaults when input is null/undefined', () => {
      expect(mergeBrandingDefaults(null)).toEqual(BRANDING_DEFAULTS);
      expect(mergeBrandingDefaults(undefined)).toEqual(BRANDING_DEFAULTS);
    });

    it('overrides only provided keys', () => {
      const merged = mergeBrandingDefaults({ name: 'Acme Corp', primary_color: '#ff0000' });
      expect(merged.name).toBe('Acme Corp');
      expect(merged.primary_color).toBe('#ff0000');
      expect(merged.secondary_color).toBe(BRANDING_DEFAULTS.secondary_color);
    });
  });

  describe('isValidHex', () => {
    it.each([
      ['#fff', true],
      ['#FFFFFF', true],
      ['#2ecc71', true],
      ['fff', true],
      ['FFF', true],
      ['#ggg', false],
      ['#12345', false],
      ['', false],
      [null, false],
      [undefined, false],
    ])('isValidHex(%p) === %p', (input, expected) => {
      expect(isValidHex(input as unknown as string)).toBe(expected);
    });
  });

  describe('normalizeHex', () => {
    it('expands short hex', () => {
      expect(normalizeHex('#abc')).toBe('#aabbcc');
      expect(normalizeHex('FFF')).toBe('#ffffff');
    });

    it('lowercases long hex and adds # prefix', () => {
      expect(normalizeHex('FF00AA')).toBe('#ff00aa');
    });

    it('returns input as-is for invalid hex', () => {
      expect(normalizeHex('not-a-color')).toBe('not-a-color');
    });

    it('handles empty/null', () => {
      expect(normalizeHex(null)).toBe('');
      expect(normalizeHex(undefined)).toBe('');
    });
  });

  describe('paymentStateBadge', () => {
    it('enabled → success', () => {
      expect(paymentStateBadge('enabled')).toEqual({ label: 'Activo', variant: 'success' });
    });
    it('requires_configuration → warning', () => {
      expect(paymentStateBadge('requires_configuration')).toEqual({
        label: 'Requiere config',
        variant: 'warning',
      });
    });
    it('disabled → neutral', () => {
      expect(paymentStateBadge('disabled')).toEqual({ label: 'Desactivado', variant: 'neutral' });
    });
    it('null/undefined → neutral fallback', () => {
      expect(paymentStateBadge(null).variant).toBe('neutral');
      expect(paymentStateBadge(undefined).variant).toBe('neutral');
    });
  });

  describe('formatAmountRange', () => {
    it('returns "Sin límites" when both null', () => {
      expect(formatAmountRange({ min_amount: null, max_amount: null })).toBe('Sin límites');
    });

    it('formats min + max', () => {
      expect(formatAmountRange({ min_amount: 1000, max_amount: 5000 })).toBe('$1.000 – $5.000');
    });

    it('formats min only', () => {
      expect(formatAmountRange({ min_amount: 1000, max_amount: null })).toBe('Mín. $1.000');
    });

    it('formats max only', () => {
      expect(formatAmountRange({ min_amount: null, max_amount: 9999 })).toBe('Máx. $9.999');
    });
  });

  describe('summarizePaymentStats', () => {
    it('maps keys', () => {
      expect(
        summarizePaymentStats({
          total_methods: 10,
          enabled_methods: 6,
          disabled_methods: 2,
          requires_config: 2,
        }),
      ).toEqual({ total: 10, enabled: 6, disabled: 2, requiresConfig: 2 });
    });
  });

  describe('brandingName', () => {
    it('returns input name when present', () => {
      expect(brandingName({ name: 'Acme' })).toBe('Acme');
    });
    it('falls back to default name', () => {
      expect(brandingName(null)).toBe(BRANDING_DEFAULTS.name);
      expect(brandingName({ name: '   ' })).toBe(BRANDING_DEFAULTS.name);
    });
  });
});
