import {
  resolveEffectiveRefundChannel,
  API_REVERSIBLE_REFUND_PROCESSORS,
} from './refund-channel.util';

/**
 * Cobertura mínima — un caso por fila de la tabla de resolución:
 *
 *  1. `original_payment` + `cash`                → `cash`
 *  2. `original_payment` + `cash_on_delivery`    → `cash`
 *  3. `original_payment` + `bank_transfer`       → `bank_transfer`
 *  4. `original_payment` + `wompi`               → `gateway`
 *  5. `original_payment` + `paypal`              → `gateway`
 *  6. `original_payment` + `stripe`              → `gateway`
 *  7. `original_payment` + `paymentType` null    → `gateway`
 *  8. `original_payment` + `paymentType` unknown → `gateway`
 *  9. `cash`                                     → `cash`
 * 10. `bank_transfer`                            → `bank_transfer`
 * 11. `store_credit`                             → `store_credit`
 * 12. refund_method desconocido (`'foo'`)        → `gateway`
 *
 * Mantener en sync con la lista `API_REVERSIBLE_REFUND_PROCESSORS` que
 * también consume `dispatchRefundProcessor` (refund-flow.service.ts).
 */
describe('resolveEffectiveRefundChannel', () => {
  describe('original_payment — delegación al tipo de pago original', () => {
    it('original_payment + cash → cash', () => {
      expect(resolveEffectiveRefundChannel('original_payment', 'cash')).toBe(
        'cash',
      );
    });

    it('original_payment + cash_on_delivery → cash', () => {
      expect(
        resolveEffectiveRefundChannel('original_payment', 'cash_on_delivery'),
      ).toBe('cash');
    });

    it('original_payment + bank_transfer → bank_transfer', () => {
      expect(
        resolveEffectiveRefundChannel('original_payment', 'bank_transfer'),
      ).toBe('bank_transfer');
    });

    it('original_payment + wompi → gateway', () => {
      expect(resolveEffectiveRefundChannel('original_payment', 'wompi')).toBe(
        'gateway',
      );
    });

    it('original_payment + paypal → gateway', () => {
      expect(resolveEffectiveRefundChannel('original_payment', 'paypal')).toBe(
        'gateway',
      );
    });

    it('original_payment + stripe → gateway', () => {
      expect(resolveEffectiveRefundChannel('original_payment', 'stripe')).toBe(
        'gateway',
      );
    });

    it('original_payment + paymentType undefined → gateway (fallback)', () => {
      expect(
        resolveEffectiveRefundChannel('original_payment', undefined),
      ).toBe('gateway');
    });

    it('original_payment + paymentType null → gateway (fallback)', () => {
      expect(resolveEffectiveRefundChannel('original_payment', null)).toBe(
        'gateway',
      );
    });

    it('original_payment + paymentType desconocido → gateway (fallback)', () => {
      expect(
        resolveEffectiveRefundChannel('original_payment', 'unknown_xyz'),
      ).toBe('gateway');
    });
  });

  describe('refund_method explícito', () => {
    it('cash → cash', () => {
      expect(resolveEffectiveRefundChannel('cash')).toBe('cash');
    });

    it('bank_transfer → bank_transfer', () => {
      expect(resolveEffectiveRefundChannel('bank_transfer')).toBe(
        'bank_transfer',
      );
    });

    it('store_credit → store_credit', () => {
      expect(resolveEffectiveRefundChannel('store_credit')).toBe('store_credit');
    });

    it('refund_method desconocido (ej. "foo") → gateway (fallback)', () => {
      expect(resolveEffectiveRefundChannel('foo')).toBe('gateway');
    });

    it('refund_method vacío → gateway (fallback)', () => {
      expect(resolveEffectiveRefundChannel('')).toBe('gateway');
    });
  });

  describe('API_REVERSIBLE_REFUND_PROCESSORS', () => {
    it('expone la lista canónica de pasarelas reversibles', () => {
      expect(API_REVERSIBLE_REFUND_PROCESSORS).toEqual([
        'wompi',
        'paypal',
        'stripe',
      ]);
    });
  });
});