import { ErrorCodes } from 'src/common/errors';

import { assertProductSaleValid } from './product-sale.util';

/**
 * Un producto en oferta con `sale_price >= base_price` cobraba MÁS bajo la
 * etiqueta de oferta. La página lo valida, pero la API, Vexi y las cargas no:
 * `PROD_SALE_PRICE_001` existía y nadie lo lanzaba. Spec S11.
 */
describe('assertProductSaleValid', () => {
  const codeOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (e: any) {
      return e.errorCode;
    }
  };

  it('sin oferta no valida el precio de oferta', () => {
    expect(
      codeOf(() =>
        assertProductSaleValid(
          { is_on_sale: false, sale_price: 20000, base_price: 10000 },
          { is_on_sale: false },
        ),
      ),
    ).toBeNull();
  });

  it('una oferta menor que el precio base es válida', () => {
    expect(
      codeOf(() =>
        assertProductSaleValid(
          { is_on_sale: true, sale_price: '8000.00', base_price: '10000.00' },
          { sale_price: 8000 },
        ),
      ),
    ).toBeNull();
  });

  it('una oferta igual o mayor que el precio base se rechaza', () => {
    for (const sale_price of [10000, 12000]) {
      expect(
        codeOf(() =>
          assertProductSaleValid(
            { is_on_sale: true, sale_price, base_price: 10000 },
            { sale_price },
          ),
        ),
      ).toBe(ErrorCodes.PROD_SALE_PRICE_001.code);
    }
  });

  it('una oferta en 0 o vacía se rechaza', () => {
    expect(
      codeOf(() =>
        assertProductSaleValid(
          { is_on_sale: true, sale_price: null, base_price: 10000 },
          { is_on_sale: true },
        ),
      ),
    ).toBe(ErrorCodes.PROD_SALE_PRICE_001.code);
  });

  it('un guardado que no toca precio ni oferta no se bloquea por datos viejos', () => {
    expect(
      codeOf(() =>
        assertProductSaleValid(
          { is_on_sale: true, sale_price: 12000, base_price: 10000 },
          { name: 'Renombrado' } as object,
        ),
      ),
    ).toBeNull();
  });
});
