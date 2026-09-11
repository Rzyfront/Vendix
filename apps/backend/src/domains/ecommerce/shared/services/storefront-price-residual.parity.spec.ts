import { StorefrontPriceService } from './storefront-price.service';

/**
 * A.2 (CP-facturacion-impuesto-incluido-redondeo, F-061) — ARCHIVO NUEVO.
 *
 * El check de `unclosed_residual_cents` en `StorefrontPriceService.resolveLine`:
 * warn estructurado con inputs cuando el bruto es inalcanzable, silencio (sin
 * warn) cuando cierra. La vitrina muestra: no persiste ni bloquea.
 */
describe('A.2 — storefront residual check (F-061)', () => {
  const priceResolver = {
    resolvePrice: jest.fn(({ product }: any) => ({
      unitPrice: Number(product.base_price),
      unitPriceWithTax: Number(product.base_price),
      unitBasePrice: Number(product.base_price),
      compareAtPrice: null,
      appliedPriceTierId: null,
      appliedPriceTierName: null,
      unitsPerPackage: 1,
      source: 'spec',
    })),
  };

  const product = (base_price: number) => ({
    base_price,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
  });

  function buildService() {
    const service = new StorefrontPriceService(priceResolver as any);
    const warn = jest.fn();
    (service as any).logger = { warn };
    return { service, warn };
  }

  it('bruto cerrable ($3.000 INC 8%): sin warn, total == publicado', () => {
    const { service, warn } = buildService();
    const out = service.resolveLine({
      product: product(3000),
      quantity: 1,
      taxRates: [{ rate: 0.08, is_inclusive: true }],
    } as any);
    expect(out.gross_unit_price).toBe(3000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('bruto inalcanzable ($17 INC 8%): warn estructurado con inputs', () => {
    const { service, warn } = buildService();
    const out = service.resolveLine({
      product: product(17),
      quantity: 1,
      taxRates: [{ rate: 0.08, is_inclusive: true }],
    } as any);
    // Closest-below del espejo: 16.99, nunca overshoot.
    expect(out.gross_unit_price).toBe(16.99);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      event: 'storefront.unclosed_residual_cents',
      unit_price: 17,
      residual_cents: 1,
    });
  });

  it('camino legacy (sin taxRates): sin warn', () => {
    const { service, warn } = buildService();
    service.resolveLine({ product: product(17), quantity: 1 } as any);
    expect(warn).not.toHaveBeenCalled();
  });
});
