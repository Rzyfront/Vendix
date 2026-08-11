import { createProductTools, ProductToolDeps } from './products.tools';

/**
 * QUI-648 — `get_product_pricing` es la superficie por la que Vexi le dice al
 * comerciante "cuánto ganas con esto". El margen salía de restar
 * `products.cost_price` (unidad MÍNIMA de stock, lo escribe `CostingService`
 * como valor / quantity_on_hand) de un precio que cubre
 * `products.price_unit_quantity` de esas unidades: para un cable en milímetros
 * publicado por metro, el chat reportaba un 166.566% sobre un negocio que gana
 * 66%. No es un número decorativo — es con el que se decide subir o bajar
 * precios.
 *
 * Estas pruebas fijan las dos mitades del contrato: escala 1 (todo el catálogo
 * histórico) responde EXACTAMENTE lo de siempre, y escala N mide el costo y el
 * precio en la misma unidad.
 */
describe('products.tools · get_product_pricing (QUI-648 escalas)', () => {
  const STORE_ID = 10;
  const PRODUCT_ID = 378;

  /**
   * Arma el tool con dependencias mínimas. `priceResolver` devuelve el precio
   * ya resuelto —su lógica no es lo que se prueba acá— y `prisma` sirve la
   * fila del producto tal como la lee el handler.
   */
  function buildTool(product: Record<string, unknown>) {
    const deps = {
      productsService: {} as any,
      priceResolver: {
        resolvePrice: jest.fn().mockReturnValue({
          unitPrice: Number(product.base_price),
          unitPriceWithTax: Number(product.base_price),
          compareAtPrice: null,
          isOnSale: false,
          source: 'base_price',
          reason: 'precio base',
        }),
        resolveWithTier: jest.fn(),
      } as any,
      settingsService: {
        getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      } as any,
      prisma: {
        products: {
          findFirst: jest.fn().mockResolvedValue({
            id: PRODUCT_ID,
            name: 'Cable de cobre',
            sku: 'CABLE-QUI648',
            state: 'active',
            is_on_sale: false,
            sale_price: null,
            track_inventory: true,
            has_multiple_price_tiers: false,
            product_tax_assignments: [],
            product_variants: [],
            _count: { product_variants: 0 },
            ...product,
          }),
        },
      } as any,
    } satisfies ProductToolDeps;

    const tool = createProductTools(deps).find(
      (registered) => registered.name === 'get_product_pricing',
    );
    if (!tool?.handler) throw new Error('get_product_pricing sin handler');
    return tool.handler;
  }

  const run = async (product: Record<string, unknown>) =>
    JSON.parse(
      await buildTool(product)(
        { product_id: PRODUCT_ID },
        { store_id: STORE_ID },
      ),
    );

  it('escala 1: costo y margen salen intactos (no-regresión)', async () => {
    const answer = await run({
      base_price: 1000,
      cost_price: 700,
      profit_margin: 42.86,
      price_unit_quantity: 1,
    });

    expect(answer.price.cost_price).toBe(700);
    expect(answer.price.margin_amount).toBe(300);
    expect(answer.price.margin_pct).toBe(42.86);
    // Sin escala el campo no viaja: no ensucia la respuesta del 99% del catálogo.
    expect(answer.price.price_unit_quantity).toBeUndefined();
  });

  it('price_unit_quantity nulo se comporta igual que escala 1 (no-regresión)', async () => {
    const answer = await run({
      base_price: 1000,
      cost_price: 700,
      profit_margin: 42.86,
      price_unit_quantity: null,
    });

    expect(answer.price.cost_price).toBe(700);
    expect(answer.price.margin_pct).toBe(42.86);
    expect(answer.price.price_unit_quantity).toBeUndefined();
  });

  it('escala 1000: el costo se reporta y se resta en la unidad del precio', async () => {
    // $5.000 el metro contra $3 el milímetro ⇒ $3.000 el metro ⇒ 66,67%.
    const answer = await run({
      base_price: 5000,
      cost_price: 3,
      profit_margin: 66.67,
      price_unit_quantity: 1000,
    });

    expect(answer.price.cost_price).toBe(3000);
    expect(answer.price.margin_amount).toBe(2000);
    expect(answer.price.margin_pct).toBe(66.67);
    // El modelo necesita saber en qué unidad está leyendo estos números.
    expect(answer.price.price_unit_quantity).toBe(1000);
    // El número que reportaba el bug.
    expect(answer.price.margin_pct).not.toBeCloseTo(166566.67, 2);
  });

  it('sin costo el margen sigue siendo null, no un 100% inventado', async () => {
    const answer = await run({
      base_price: 5000,
      cost_price: null,
      profit_margin: null,
      price_unit_quantity: 1000,
    });

    expect(answer.price.cost_price).toBeNull();
    expect(answer.price.margin_amount).toBeNull();
    expect(answer.price.margin_pct).toBeNull();
  });
});
