import { ErrorCodes, VendixHttpException } from 'src/common/errors';

import { assertVariantRemovalAllowed } from './variant-removal-guard.util';

/**
 * Guardar un producto quitando ALGUNAS variantes borraba sus `stock_levels`
 * cuando la petición traía `variant_removal_stock_mode`: el inventario de esas
 * variantes desaparecía sin ajuste ni movimiento. Solo al quitar TODAS las
 * variantes hay a dónde mover el saldo (el producto base). Spec:
 * odd/tasks/price-tier-adjustments-customers.md S11.
 */
describe('assertVariantRemovalAllowed', () => {
  const variant = (over: Partial<Parameters<typeof assertVariantRemovalAllowed>[0][number]> = {}) => ({
    id: 1,
    sku: 'CAM-ROJA-M',
    on_hand: 0,
    has_active_reservations: false,
    ...over,
  });

  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      expect(e).toBeInstanceOf(VendixHttpException);
      return (e as VendixHttpException).errorCode;
    }
  };

  it('quitar variantes sin existencias ni reservas se permite', () => {
    expect(() =>
      assertVariantRemovalAllowed([variant()], {
        removingAll: false,
        removalMode: undefined,
      }),
    ).not.toThrow();
  });

  it('quitar ALGUNAS variantes con existencias se bloquea aunque venga el modo', () => {
    const fn = () =>
      assertVariantRemovalAllowed([variant({ on_hand: 40 })], {
        removingAll: false,
        removalMode: 'distribute',
      });
    expect(fn).toThrow(/CAM-ROJA-M.*40/);
    expect(codeOf(fn)).toBe(ErrorCodes.PROD_VARIANT_HAS_STOCK_001.code);
  });

  it('quitar ALGUNAS variantes con reservas activas se bloquea', () => {
    const fn = () =>
      assertVariantRemovalAllowed([variant({ has_active_reservations: true })], {
        removingAll: false,
        removalMode: 'distribute',
      });
    expect(codeOf(fn)).toBe(ErrorCodes.PROD_HAS_RESERVATIONS_001.code);
  });

  describe('quitar TODAS las variantes (el saldo pasa al producto base)', () => {
    it('con existencias y sin modo explícito se rechaza como antes', () => {
      const fn = () =>
        assertVariantRemovalAllowed([variant({ on_hand: 5 })], {
          removingAll: true,
          removalMode: undefined,
        });
      expect(codeOf(fn)).toBe(ErrorCodes.PROD_VALIDATE_001.code);
    });

    it('con existencias y modo explícito se permite como antes', () => {
      expect(() =>
        assertVariantRemovalAllowed([variant({ on_hand: 5 })], {
          removingAll: true,
          removalMode: 'distribute',
        }),
      ).not.toThrow();
    });
  });
});
