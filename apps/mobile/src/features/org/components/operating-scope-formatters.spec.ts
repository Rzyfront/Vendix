import {
  scopeLabel,
  scopeShortLabel,
  scopeDescription,
  blockerTitle,
  directionLabel,
  directionArrow,
  forceReasonRemaining,
  isForceReasonValid,
  formatAuditDate,
} from './operating-scope-formatters';

describe('operating-scope-formatters', () => {
  describe('scopeLabel', () => {
    it('returns Spanish label for STORE', () => {
      expect(scopeLabel('STORE')).toBe('Por tienda');
    });
    it('returns Spanish label for ORGANIZATION', () => {
      expect(scopeLabel('ORGANIZATION')).toBe('Organización (consolidado)');
    });
    it('falls back to "Por tienda" for unknown values', () => {
      expect(scopeLabel('UNKNOWN')).toBe('Por tienda');
    });
    it('handles null/undefined safely', () => {
      expect(scopeLabel(null)).toBe('Por tienda');
      expect(scopeLabel(undefined)).toBe('Por tienda');
    });
  });

  describe('scopeShortLabel', () => {
    it('returns "Organización" for ORGANIZATION', () => {
      expect(scopeShortLabel('ORGANIZATION')).toBe('Organización');
    });
    it('returns "Tienda" for STORE', () => {
      expect(scopeShortLabel('STORE')).toBe('Tienda');
    });
  });

  describe('scopeDescription', () => {
    it('describes STORE correctly', () => {
      expect(scopeDescription('STORE')).toBe('Cada tienda maneja su propio inventario');
    });
    it('describes ORGANIZATION correctly', () => {
      expect(scopeDescription('ORGANIZATION')).toBe('Inventario consolidado entre tiendas');
    });
  });

  describe('blockerTitle', () => {
    it('maps OPEN_POS_TO_CENTRAL to Spanish title', () => {
      expect(
        blockerTitle({ code: 'OPEN_POS_TO_CENTRAL', message: 'x' }),
      ).toBe('Órdenes de compra abiertas hacia bodega central');
    });
    it('maps OPEN_PURCHASE_ORDERS', () => {
      expect(
        blockerTitle({ code: 'OPEN_PURCHASE_ORDERS', message: 'x' }),
      ).toBe('Órdenes de compra consolidadas abiertas');
    });
    it('maps OPEN_CROSS_STORE_TRANSFERS', () => {
      expect(
        blockerTitle({ code: 'OPEN_CROSS_STORE_TRANSFERS', message: 'x' }),
      ).toBe('Transferencias inter-tienda abiertas');
    });
    it('maps STOCK_AT_CENTRAL', () => {
      expect(
        blockerTitle({ code: 'STOCK_AT_CENTRAL', message: 'x' }),
      ).toBe('Stock en bodega central');
    });
    it('maps ACTIVE_RESERVATIONS_AT_CENTRAL', () => {
      expect(
        blockerTitle({ code: 'ACTIVE_RESERVATIONS_AT_CENTRAL', message: 'x' }),
      ).toBe('Reservas activas en bodega central');
    });
    it('maps PARTNER_LOCKED', () => {
      expect(
        blockerTitle({ code: 'PARTNER_LOCKED', message: 'x' }),
      ).toBe('Organización partner bloqueada');
    });
    it('maps NOT_ENOUGH_STORES', () => {
      expect(
        blockerTitle({ code: 'NOT_ENOUGH_STORES', message: 'x' }),
      ).toBe('Tiendas activas insuficientes');
    });
    it('maps NO_ACTIVE_STORES', () => {
      expect(
        blockerTitle({ code: 'NO_ACTIVE_STORES', message: 'x' }),
      ).toBe('No hay tiendas activas');
    });
    it('falls back to raw code for unknown blockers', () => {
      expect(blockerTitle({ code: 'CUSTOM_CODE', message: 'x' })).toBe('CUSTOM_CODE');
    });
  });

  describe('directionLabel', () => {
    it('returns UP migration label', () => {
      expect(directionLabel('UP')).toBe('Migración STORE → ORGANIZATION');
    });
    it('returns DOWN migration label', () => {
      expect(directionLabel('DOWN')).toBe('Migración ORGANIZATION → STORE');
    });
    it('returns NOOP label for NOOP', () => {
      expect(directionLabel('NOOP')).toBe('Sin cambios');
    });
    it('falls back to "Sin cambios" for unknown values', () => {
      expect(directionLabel('XXX')).toBe('Sin cambios');
    });
  });

  describe('directionArrow', () => {
    it('formats STORE → ORGANIZATION arrow', () => {
      expect(directionArrow('STORE', 'ORGANIZATION')).toBe('Tienda → Organización');
    });
    it('formats ORGANIZATION → STORE arrow', () => {
      expect(directionArrow('ORGANIZATION', 'STORE')).toBe('Organización → Tienda');
    });
    it('formats STORE → STORE arrow (no-op)', () => {
      expect(directionArrow('STORE', 'STORE')).toBe('Tienda → Tienda');
    });
  });

  describe('forceReasonRemaining', () => {
    it('returns 10 when input is empty', () => {
      expect(forceReasonRemaining('')).toBe(10);
    });
    it('returns 0 when input meets minimum length', () => {
      expect(forceReasonRemaining('1234567890')).toBe(0);
    });
    it('counts trimmed length only', () => {
      expect(forceReasonRemaining('   1234   ')).toBe(6);
    });
    it('never returns negative values', () => {
      expect(forceReasonRemaining('a long reason here')).toBe(0);
    });
  });

  describe('isForceReasonValid', () => {
    it('returns false for empty input', () => {
      expect(isForceReasonValid('')).toBe(false);
    });
    it('returns false for short input', () => {
      expect(isForceReasonValid('short')).toBe(false);
    });
    it('returns true for input of exactly 10 chars', () => {
      expect(isForceReasonValid('1234567890')).toBe(true);
    });
    it('returns true for input longer than 10 chars', () => {
      expect(isForceReasonValid('a much longer reason')).toBe(true);
    });
    it('trims whitespace before validation', () => {
      expect(isForceReasonValid('   1234567890   ')).toBe(true);
    });
  });

  describe('formatAuditDate', () => {
    it('returns "—" for null/undefined', () => {
      expect(formatAuditDate(null)).toBe('—');
      expect(formatAuditDate(undefined)).toBe('—');
    });
    it('returns the raw string when input is not a valid date', () => {
      expect(formatAuditDate('not-a-date')).toBe('not-a-date');
    });
    it('formats valid ISO strings to a locale string', () => {
      const formatted = formatAuditDate('2026-06-19T15:30:00.000Z');
      // We don't assert on the exact locale string (varies by environment),
      // just that it's non-empty and not the raw input.
      expect(formatted).not.toBe('2026-06-19T15:30:00.000Z');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});