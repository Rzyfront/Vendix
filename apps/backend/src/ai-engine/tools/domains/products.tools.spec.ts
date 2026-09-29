import { createProductTools, ProductToolDeps } from './products.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

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
   * ya resuelto —su lógica no es lo que se prueba acá— y el service sirve
   * la fila del producto tal como la lee el handler.
   */
  function buildTool(product: Record<string, unknown>) {
    const deps = {
      productsService: {
        findProductPricingForAgent: jest.fn().mockResolvedValue({
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
        // Sin asignaciones no hay impuesto: tasa 0 como el `totalTaxRate`
        // local que T1 eliminó.
        getEffectiveTaxRate: jest.fn().mockReturnValue(0),
        findProductPriceTiersForAgent: jest
          .fn()
          .mockResolvedValue({ tiers: [], overrides: [] }),
      } as any,
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

/**
 * T4 — Spec canónica de contrato (esta familia fija el patrón que copian
 * todas las demás). Cada familia pinnea 5 dimensiones:
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`, sin
 *     `.snap` que derive en silencio);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) circuito de escritura: esta familia es 100% `readOnly`, así que el
 *     bloque de registro pinnea que NINGÚN tool declara
 *     `requiresConfirmation`. Si mañana se agrega un write, este bloque falla
 *     a propósito y obliga a extender la spec con sus casos de
 *     confirmación + `preview` antes de que el CI pase.
 */
describe('products.tools · contrato canónico T4', () => {
  const STORE_ID = 7;

  /**
   * Tasa aditiva derivada de las asignaciones del fixture, igual que el
   * `totalTaxRate` local que T1 movió a `ProductsService.getEffectiveTaxRate`:
   * los snapshots pinnean el cableado tool→service, no la matemática fiscal
   * (esa vive en el service y sus propias specs).
   */
  function fixtureTaxRate(product: any): number {
    let rate = 0;
    for (const assignment of product?.product_tax_assignments ?? []) {
      for (const tax of assignment?.tax_categories?.tax_rates ?? []) {
        rate += Number(tax.rate);
      }
    }
    return rate;
  }

  function fixtureFinalPrice(product: any): number {
    const base =
      product?.is_on_sale && product?.sale_price
        ? Number(product.sale_price)
        : Number(product?.base_price ?? 0);
    return base * (1 + fixtureTaxRate(product));
  }

  function baseDeps() {
    return {
      productsService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findProductIdsForAgent: jest.fn(),
        findProductFuzzyPoolForAgent: jest.fn(),
        findProductCardsForAgent: jest.fn(),
        findProductPricingForAgent: jest.fn(),
        findProductPriceTiersForAgent: jest
          .fn()
          .mockResolvedValue({ tiers: [], overrides: [] }),
        getEffectiveTaxRate: jest.fn(fixtureTaxRate),
        calculateFinalPrice: jest.fn(fixtureFinalPrice),
      } as any,
      priceResolver: {
        resolvePrice: jest.fn(),
        resolveWithTier: jest.fn(),
      } as any,
      settingsService: {
        getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      } as any,
    } satisfies ProductToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createProductTools(deps) };
  }

  function getHandler(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool.handler;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID },
  ) => JSON.parse(await getHandler(tools, name)(args, context as any));

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 4 tools del dominio products', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'find_product',
        'get_product',
        'list_products',
        'get_product_pricing',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('products');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('todos exigen store:products:read', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['store:products:read']);
      }
    });

    it('familia 100% readOnly: ningún write sin circuito de confirmación', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums del JSON Schema', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(byName.get('find_product')!.parameters.required).toEqual([
        'query',
      ]);
      expect(byName.get('get_product')!.parameters.required).toEqual([
        'product_id',
      ]);
      expect(
        byName.get('list_products')!.parameters.required ?? [],
      ).toEqual([]);
      expect(byName.get('get_product_pricing')!.parameters.required).toEqual([
        'product_id',
      ]);
      expect(
        byName.get('list_products')!.parameters.properties.product_type.enum,
      ).toEqual(['physical', 'service', 'prepared']);
      expect(
        byName.get('list_products')!.parameters.properties.state.enum,
      ).toEqual(['active', 'inactive', 'archived']);
    });
  });

  // ─── find_product ─────────────────────────────────────────────────────
  describe('find_product', () => {
    const PRODUCT_ROW = {
      id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      barcode: '7701234567890',
      state: 'active',
      product_type: 'physical',
      track_inventory: true,
      is_sellable: true,
      base_price: 5000,
      sale_price: null,
      is_on_sale: false,
      stock_unit: 'unit',
      requires_booking: false,
      has_multiple_price_tiers: false,
      brands: { name: 'Coca Cola' },
      product_tax_assignments: [
        { tax_categories: { tax_rates: [{ rate: 0.19, name: 'IVA 19%' }] } },
      ],
      product_variants: [],
      _count: { product_variants: 0 },
      stock_levels: [{ product_variant_id: null, quantity_available: 42 }],
    };

    const EXPECTED_CARD = {
      product_id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      barcode: '7701234567890',
      brand: 'Coca Cola',
      state: 'active',
      product_type: 'physical',
      is_sellable: true,
      requires_booking: false,
      stock_unit: 'unit',
      net_price: 5000,
      unit_price: 5950,
      tax_rate_pct: 19,
      inventory_tracked: true,
      available_stock: 42,
      has_variants: false,
      variant_count: 0,
      requires_variant_selection: false,
      has_multiple_price_tiers: false,
    };

    /**
     * Los intentos barcode/sku vuelven vacíos y el de nombre resuelve los ids;
     * la hidratación trae las fichas. El pase por id vive en el service (T1).
     */
    function mockIdPass(deps: any, ids: number[], cards: any[]) {
      deps.productsService.findProductIdsForAgent.mockImplementation(
        async (where: any) =>
          where?.AND ? ids.map((id) => ({ id })) : [],
      );
      deps.productsService.findProductCardsForAgent.mockResolvedValue(cards);
    }

    it('(b) happy: snapshot exacto de coincidencia única por nombre', async () => {
      const { deps, tools } = buildTools();
      mockIdPass(deps, [101], [PRODUCT_ROW]);

      const answer = await run(tools, 'find_product', { query: 'Coca Cola' });

      expect(answer).toEqual({
        query: 'Coca Cola',
        matched_by: 'nombre',
        match_count: 1,
        ambiguous: false,
        currency: 'COP',
        products: [EXPECTED_CARD],
        next_step:
          'Ya tienes el product_id para encadenar get_product, get_product_pricing, check_stock_availability o create_stock_adjustment.',
        notes: [
          'available_stock en null significa que ese producto o variante NO lleva control de inventario; no es lo mismo que cero unidades y no impide venderlo.',
        ],
      });
    });

    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'find_product',
        { query: 'Coca Cola' },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: el catálogo se resuelve siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findProductIdsForAgent,
      ).not.toHaveBeenCalled();
      expect(
        deps.productsService.findProductCardsForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: query de 1 carácter → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'find_product', { query: 'a' });

      expect(answer).toEqual({
        error:
          'La búsqueda necesita al menos 2 caracteres. Pide al usuario el nombre, el SKU o el código de barras del producto.',
      });
      expect(
        deps.productsService.findProductIdsForAgent,
      ).not.toHaveBeenCalled();
      expect(
        deps.productsService.findProductCardsForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) sin coincidencias → match_count 0 con next_step que prohíbe inventar', async () => {
      const deps = baseDeps();
      deps.productsService.findProductIdsForAgent = jest
        .fn()
        .mockResolvedValueOnce([]) // barcode
        .mockResolvedValueOnce([]) // sku
        .mockResolvedValueOnce([]); // nombre
      deps.productsService.findProductFuzzyPoolForAgent = jest
        .fn()
        .mockResolvedValueOnce([]); // fuzzy pool vacío
      const rebuilt = createProductTools(deps);

      const answer = await run(rebuilt, 'find_product', { query: 'zzrt pop' });

      expect(answer).toEqual({
        query: 'zzrt pop',
        match_count: 0,
        products: [],
        next_step:
          'Ningún producto coincide. Si tienes semantic_search disponible y el usuario lo describió de forma indirecta, pruébala; si no, pídele el SKU o el código de barras. No inventes un product_id.',
      });
    });

    it('(a) ambiguo: varias coincidencias → ambiguous + next_step de confirmación', async () => {
      const { deps, tools } = buildTools();
      const secondRow = {
        ...PRODUCT_ROW,
        id: 102,
        name: 'Coca Cola 2L',
        sku: 'COCA-2L',
        base_price: 8000,
        product_tax_assignments: [],
        stock_levels: [{ product_variant_id: null, quantity_available: 7 }],
      };
      mockIdPass(deps, [101, 102], [PRODUCT_ROW, secondRow]);

      const answer = await run(tools, 'find_product', { query: 'Coca Cola' });

      expect(answer.match_count).toBe(2);
      expect(answer.ambiguous).toBe(true);
      expect(answer.products).toHaveLength(2);
      expect(answer.products[1]).toMatchObject({
        product_id: 102,
        net_price: 8000,
        unit_price: 8000,
        tax_rate_pct: 0,
        available_stock: 7,
      });
      expect(answer.next_step).toContain(
        'Hay más de un producto posible.',
      );
    });
  });

  // ─── get_product ──────────────────────────────────────────────────────
  describe('get_product', () => {
    const SERVICE_ROW = {
      id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      barcode: '7701234567890',
      description: 'Gaseosa familiar',
      brand: { name: 'Coca Cola' },
      categories: [{ name: 'Bebidas' }],
      state: 'active',
      product_type: 'physical',
      is_sellable: true,
      is_ingredient: false,
      is_combo: false,
      is_batch_produced: false,
      available_for_ecommerce: true,
      is_featured: false,
      cost_price: 3000,
      base_price: 5000,
      is_on_sale: false,
      sale_price: null,
      profit_margin: 66.67,
      product_tax_assignments: [
        { tax_categories: { tax_rates: [{ rate: 0.19, name: 'IVA 19%' }] } },
      ],
      final_price: 5950,
      has_multiple_price_tiers: false,
      track_inventory: true,
      stock_unit: 'unit',
      purchase_unit: null,
      purchase_to_stock_factor: null,
      total_stock_available: 42,
      total_stock_reserved: 3,
      reorder_point: 10,
      low_stock_threshold: 5,
      requires_serial_numbers: false,
      stock_by_location: [
        {
          location_id: 1,
          location_name: 'Bodega',
          location_type: 'warehouse',
          available: 40,
          reserved: 3,
        },
      ],
      product_variants: [],
      stock_levels: [],
    };

    it('(b) happy: snapshot exacto de la ficha', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findOne.mockResolvedValue(SERVICE_ROW);

      const answer = await run(tools, 'get_product', { product_id: 101 });

      expect(deps.productsService.findOne).toHaveBeenCalledWith(101);
      expect(answer).toEqual({
        product: {
          product_id: 101,
          name: 'Coca Cola 1L',
          sku: 'COCA-1L',
          barcode: '7701234567890',
          description: 'Gaseosa familiar',
          brand: 'Coca Cola',
          categories: ['Bebidas'],
          state: 'active',
          product_type: 'physical',
          is_sellable: true,
          is_ingredient: false,
          is_combo: false,
          is_batch_produced: false,
          available_for_ecommerce: true,
          is_featured: false,
        },
        pricing: {
          currency: 'COP',
          cost_price: 3000,
          base_price: 5000,
          is_on_sale: false,
          sale_price: null,
          profit_margin_pct: 66.67,
          tax_rate_pct: 19,
          taxes: [{ name: 'IVA 19%', rate_pct: 19 }],
          unit_price: 5950,
          has_multiple_price_tiers: false,
          note: 'unit_price incluye impuestos. Para tarifas por volumen/empaque usa get_product_pricing.',
        },
        inventory: {
          tracked: true,
          stock_unit: 'unit',
          purchase_unit: null,
          purchase_to_stock_factor: null,
          available: 42,
          reserved: 3,
          reorder_point: 10,
          low_stock_threshold: 5,
          requires_serial_numbers: false,
          by_location: [
            {
              location_id: 1,
              location: 'Bodega',
              type: 'warehouse',
              available: 40,
              reserved: 3,
            },
          ],
        },
        variants: {
          has_variants: false,
          count: 0,
          requires_variant_selection: false,
          items: [],
        },
      });
    });

    it('(a) sad: product_id inválido → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_product', { product_id: 'abc' });

      expect(answer).toEqual({
        error:
          'product_id inválido. Resuelve el producto con find_product antes de pedir su ficha.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
    });

    it('(c) service lanza → {error, next_step} hacia find_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findOne.mockRejectedValue(new Error('no existe'));

      const answer = await run(tools, 'get_product', { product_id: 999 });

      expect(answer).toEqual({
        error:
          'No existe un producto activo con id 999 en esta tienda (los archivados no se devuelven).',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
    });
  });

  // ─── list_products ────────────────────────────────────────────────────
  describe('list_products', () => {
    it('(b) happy: snapshot exacto de página + query que arma al service', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findAll.mockResolvedValue({
        data: [
          {
            id: 101,
            name: 'Coca Cola 1L',
            sku: 'COCA-1L',
            brand: { name: 'Coca Cola' },
            state: 'active',
            product_type: 'physical',
            base_price: 5000,
            final_price: 5950,
            track_inventory: true,
            stock_quantity: 42,
            product_variants: [],
          },
        ],
        meta: { total: 1, totalPages: 1 },
      });

      const answer = await run(
        tools,
        'list_products',
        { product_type: 'physical' },
      );

      expect(deps.productsService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        include_variants: true,
        include_stock: true,
        product_type: 'physical',
      });
      expect(answer).toEqual({
        currency: 'COP',
        page: 1,
        limit: 10,
        returned: 1,
        total: 1,
        total_pages: 1,
        has_more: false,
        products: [
          {
            product_id: 101,
            name: 'Coca Cola 1L',
            sku: 'COCA-1L',
            brand: 'Coca Cola',
            state: 'active',
            product_type: 'physical',
            net_price: 5000,
            unit_price: 5950,
            inventory_tracked: true,
            available_stock: 42,
            has_variants: false,
            variant_count: 0,
            requires_variant_selection: false,
          },
        ],
        note: 'Esto es una página del catálogo, no el catálogo completo: total dice cuántos hay en realidad. available_stock en null significa que el producto no lleva control de inventario.',
      });
    });

    it('(a) sad: sin tienda → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_products', {}, {});

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: el catálogo se lista siempre dentro de una tienda.',
      });
      expect(deps.productsService.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── get_product_pricing (contrato; el comportamiento fino vive en QUI-648)
  describe('get_product_pricing', () => {
    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_product_pricing',
        { product_id: 101 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los precios se resuelven siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findProductPricingForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: product_id inválido → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_product_pricing',
        { product_id: 0 },
      );

      expect(answer).toEqual({
        error:
          'product_id inválido. Resuelve el producto con find_product antes de pedir sus precios.',
      });
      expect(
        deps.productsService.findProductPricingForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) producto inexistente → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findProductPricingForAgent.mockResolvedValue(null);

      const answer = await run(
        tools,
        'get_product_pricing',
        { product_id: 999 },
      );

      expect(answer).toEqual({
        error: 'No existe un producto con id 999 en esta tienda.',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
    });

    it('(c) variante ajena → {error, next_step} hacia get_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findProductPricingForAgent.mockResolvedValue({
        id: 101,
        product_variants: [{ id: 1 }],
        _count: { product_variants: 1 },
      });

      const answer = await run(
        tools,
        'get_product_pricing',
        { product_id: 101, product_variant_id: 999 },
      );

      expect(answer).toEqual({
        error:
          'La variante 999 no pertenece al producto 101 (o quedó fuera de las primeras 25).',
        next_step:
          'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      });
      expect(deps.priceResolver.resolvePrice).not.toHaveBeenCalled();
    });
  });
});
