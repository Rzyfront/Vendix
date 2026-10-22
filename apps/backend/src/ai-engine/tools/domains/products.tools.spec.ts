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
 * (e) circuito de escritura: los 6 reads son `readOnly` y los 6 writes
 *     traen `requiresConfirmation` + `preview` con sujeto humano. Si mañana
 *     se agrega otra tool, el bloque de registro falla a propósito y obliga
 *     a extender la spec con sus casos de confirmación + `preview` antes de
 *     que el CI pase.
 *
 * Paso 10 (P1/P2 operativo): O-2 `deactivate_product`, O-3
 * `preview_archive_product`, O-4 `archive_product`, O-5
 * `manage_product_images`, O-6 `get_product_promotions`, O-7
 * `set_product_promotions` y O-8 `generate_online_purchase_link`, con la
 * cadena dura O-3→O-4 (el write exige las cifras del read).
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
        update: jest.fn(),
        deactivate: jest.fn(),
        remove: jest.fn(),
        addImage: jest.fn(),
        removeImage: jest.fn(),
        getProductPromotions: jest.fn(),
        updateProductPromotions: jest.fn(),
        generateOnlinePurchaseLink: jest.fn(),
        findProductIdsForAgent: jest.fn(),
        findProductFuzzyPoolForAgent: jest.fn(),
        findProductCardsForAgent: jest.fn(),
        findProductPricingForAgent: jest.fn(),
        findProductArchivePreviewForAgent: jest.fn(),
        findProductImageForAgent: jest.fn(),
        findPromotionsByIdsForAgent: jest.fn(),
        findOnlinePurchaseContextForAgent: jest.fn(),
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
    it('expone exactamente los 12 tools del dominio products', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'find_product',
        'get_product',
        'list_products',
        'get_product_pricing',
        'update_product',
        'deactivate_product',
        'preview_archive_product',
        'archive_product',
        'manage_product_images',
        'get_product_promotions',
        'set_product_promotions',
        'generate_online_purchase_link',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('products');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool exige el permiso de su verbo HTTP', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      // Reads puros + O-6.
      for (const name of [
        'find_product',
        'get_product',
        'list_products',
        'get_product_pricing',
        'get_product_promotions',
      ]) {
        expect(byName.get(name)!.requiredPermissions).toEqual([
          'store:products:read',
        ]);
      }
      // O-3 es read pero exige `admin_delete`, igual que su endpoint: es el
      // ensayo de un irreversible con valoración de existencias.
      expect(
        byName.get('preview_archive_product')!.requiredPermissions,
      ).toEqual(['store:products:admin_delete']);
      // Mismo verbo que el controlador: PATCH :id → update,
      // PATCH :id/deactivate → delete, DELETE :id → admin_delete,
      // POST/DELETE imágenes y PATCH promociones y POST link → update.
      expect(byName.get('update_product')!.requiredPermissions).toEqual([
        'store:products:update',
      ]);
      expect(byName.get('deactivate_product')!.requiredPermissions).toEqual([
        'store:products:delete',
      ]);
      expect(byName.get('archive_product')!.requiredPermissions).toEqual([
        'store:products:admin_delete',
      ]);
      expect(
        byName.get('manage_product_images')!.requiredPermissions,
      ).toEqual(['store:products:update']);
      expect(
        byName.get('set_product_promotions')!.requiredPermissions,
      ).toEqual(['store:products:update']);
      expect(
        byName.get('generate_online_purchase_link')!.requiredPermissions,
      ).toEqual(['store:products:update']);
    });

    it('reads 100% readOnly; los 6 writes traen circuito completo', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of [
        'find_product',
        'get_product',
        'list_products',
        'get_product_pricing',
        'preview_archive_product',
        'get_product_promotions',
      ]) {
        const tool = byName.get(name)!;
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
      for (const name of [
        'update_product',
        'deactivate_product',
        'archive_product',
        'manage_product_images',
        'set_product_promotions',
        'generate_online_purchase_link',
      ]) {
        const write = byName.get(name)!;
        expect(write.readOnly ?? false).toBe(false);
        expect(write.requiresConfirmation).toBe(true);
        expect(typeof write.preview).toBe('function');
        expect(write.clientSide ?? false).toBe(false);
        expect(typeof write.handler).toBe('function');
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
      expect(byName.get('update_product')!.parameters.required).toEqual([
        'product_id',
      ]);
      expect(byName.get('deactivate_product')!.parameters.required).toEqual([
        'product_id',
      ]);
      expect(
        byName.get('preview_archive_product')!.parameters.required,
      ).toEqual(['product_id']);
      // O-4 exige la cadena O-3→O-4: las cifras del preview viajan como
      // parámetros requeridos.
      expect(byName.get('archive_product')!.parameters.required).toEqual([
        'product_id',
        'confirmed_total_units',
        'confirmed_total_value',
      ]);
      expect(
        byName.get('manage_product_images')!.parameters.required,
      ).toEqual(['action']);
      expect(
        byName.get('manage_product_images')!.parameters.properties.action.enum,
      ).toEqual(['add', 'remove']);
      expect(
        byName.get('get_product_promotions')!.parameters.required,
      ).toEqual(['product_id']);
      expect(
        byName.get('set_product_promotions')!.parameters.required,
      ).toEqual(['product_id', 'promotion_ids']);
      expect(
        byName.get('generate_online_purchase_link')!.parameters.required,
      ).toEqual(['product_id']);
      // O-1 nunca acepta `final_price`: es un calculado de lectura, no un
      // campo persistido.
      expect(
        byName.get('update_product')!.parameters.properties.final_price,
      ).toBeUndefined();
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

  // ─── update_product (O-1, write) ────────────────────────────────────
  describe('update_product', () => {
    const PRODUCT_ROW = {
      id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      barcode: '7701234567890',
      description: 'Gaseosa familiar',
      base_price: 5000,
      cost_price: 3000,
      profit_margin: 66.67,
      is_on_sale: false,
      sale_price: null,
      track_inventory: true,
      is_sellable: true,
      available_for_ecommerce: true,
      is_featured: false,
      allow_pos_price_override: false,
      brand_id: null,
      brand: null,
    };

    function editDeps() {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(PRODUCT_ROW);
      deps.productsService.update.mockResolvedValue({
        ...PRODUCT_ROW,
        base_price: 5500,
      });
      return deps;
    }

    const preview = async (
      tools: RegisteredTool[],
      args: Record<string, any>,
      context: Record<string, any> = { store_id: STORE_ID },
    ) => {
      const tool = tools.find(
        (registered) => registered.name === 'update_product',
      );
      if (!tool?.preview) throw new Error('update_product sin preview');
      return tool.preview(args, context as any);
    };

    it('(b) happy: snapshot exacto + delega en productsService.update', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_product', {
        product_id: 101,
        name: 'Coca Cola 1.5L',
        base_price: 5500,
      });

      expect(deps.productsService.findOne).toHaveBeenCalledWith(101);
      expect(deps.productsService.update).toHaveBeenCalledWith(
        101,
        { name: 'Coca Cola 1.5L', base_price: 5500 },
        { lean: true },
      );
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): 2 campo(s) actualizado(s).',
        data: {
          product_id: 101,
          updated_fields: ['name', 'base_price'],
        },
      });
    });

    it('(e) preview ok nombra al sujeto humano con from→to y dominio', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, {
        product_id: 101,
        base_price: 5500,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          {
            field: 'base_price',
            label: 'Precio base (sin impuestos)',
            from: 5000,
            to: 5500,
          },
        ],
        domain: 'products',
      });
      // El preview es solo lectura: no escribe.
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'update_product',
        { product_id: 101, base_price: 5500 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los productos se editan siempre dentro de una tienda.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(a) sad: final_price → rechazo explícito sin tocar el service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'update_product', {
        product_id: 101,
        final_price: 5950,
      });

      expect(answer).toEqual({
        error:
          'final_price no se puede editar: es el precio calculado con impuestos que muestran las lecturas.',
        next_step:
          'Para cambiar lo que paga el cliente edita base_price (precio normal) o sale_price con is_on_sale (oferta).',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(a) sad: sin cambios → error sin escribir', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_product', { product_id: 101 });

      expect(answer).toEqual({
        error:
          'No hay cambios: indica al menos un campo a editar (name, base_price, sale_price, sku…).',
      });
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(c) producto inexistente → {error, next_step} hacia find_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findOne.mockRejectedValue(new Error('no existe'));

      const answer = await run(tools, 'update_product', {
        product_id: 999,
        base_price: 5500,
      });

      expect(answer).toEqual({
        error:
          'No existe un producto activo con id 999 en esta tienda (los archivados no se editan).',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(c) oferta inválida (sale >= base) → {error} sin escribir', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_product', {
        product_id: 101,
        is_on_sale: true,
        sale_price: 6000,
      });

      expect(answer).toEqual({
        error:
          'El precio de oferta (6000) debe ser menor que el precio normal (5000).',
      });
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(c) preview imposible → status error sin token (no escribe)', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, {
        product_id: 101,
        final_price: 5950,
      });

      expect(result.status).toBe('error');
      expect(result.target).toBe('Edición de producto');
      expect(result.changes).toEqual([]);
      expect(result.message).toContain('final_price no se puede editar');
      expect(deps.productsService.update).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error} con mensaje, nunca throw', async () => {
      const deps = editDeps();
      deps.productsService.update.mockRejectedValue(
        new Error('El SKU ya está en uso'),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_product', {
        product_id: 101,
        sku: 'DUPLICADO',
      });

      expect(answer).toEqual({
        error: 'No se pudo editar el producto: El SKU ya está en uso',
      });
    });
  });

  // ─── Paso 10 (P1/P2): preview genérico + fixtures ──────────────────────

  const previewTool = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID },
  ) => {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  const ACTIVE_PRODUCT_ROW = {
    id: 101,
    name: 'Coca Cola 1L',
    sku: 'COCA-1L',
    state: 'active',
  };

  const ARCHIVE_CONTEXT = {
    product: {
      id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      state: 'active',
    },
    plan: {
      requires_confirmation: true,
      total_units: 42,
      total_value: 126000,
      zero_cost_units: 0,
      lines: [
        {
          location_id: 1,
          location_name: 'Bodega',
          product_variant_id: null,
          variant_sku: null,
          quantity_on_hand: 42,
          unit_cost: 3000,
          value: 126000,
          has_known_cost: true,
        },
      ],
      out_of_scope_units: 0,
      out_of_scope: [],
    },
    hasActiveReservations: false,
  };

  // ─── deactivate_product (O-2, write) ──────────────────────────────────
  describe('deactivate_product', () => {
    it('(b) happy: snapshot exacto + delega en productsService.deactivate', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.deactivate.mockResolvedValue({
        ...ACTIVE_PRODUCT_ROW,
        state: 'inactive',
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'deactivate_product', {
        product_id: 101,
      });

      expect(deps.productsService.deactivate).toHaveBeenCalledWith(101);
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): desactivado, ya no se vende.',
        data: { product_id: 101, state: 'inactive' },
      });
    });

    it('(e) preview ok nombra al sujeto humano con active→inactive', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'deactivate_product', {
        product_id: 101,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          { field: 'state', label: 'Estado', from: 'active', to: 'inactive' },
        ],
        message:
          'El producto deja de venderse pero conserva su ficha, su stock y su historial.',
        domain: 'products',
      });
      expect(deps.productsService.deactivate).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'deactivate_product',
        { product_id: 101 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los productos se desactivan siempre dentro de una tienda.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.deactivate).not.toHaveBeenCalled();
    });

    it('(c) ya inactivo → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue({
        ...ACTIVE_PRODUCT_ROW,
        state: 'inactive',
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'deactivate_product', {
        product_id: 101,
      });

      expect(answer).toEqual({
        error: '"Coca Cola 1L" ya está desactivado: no hay nada que cambiar.',
      });
      expect(deps.productsService.deactivate).not.toHaveBeenCalled();
    });

    it('(c) producto inexistente → {error, next_step} hacia find_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findOne.mockRejectedValue(new Error('no existe'));

      const answer = await run(tools, 'deactivate_product', {
        product_id: 999,
      });

      expect(answer).toEqual({
        error:
          'No existe un producto con id 999 en esta tienda (los archivados no se desactivan: ya están fuera del catálogo).',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
      expect(deps.productsService.deactivate).not.toHaveBeenCalled();
    });
  });

  // ─── preview_archive_product (O-3, read) ──────────────────────────────
  describe('preview_archive_product', () => {
    it('(b) happy: snapshot exacto del plan de castigo', async () => {
      const deps = baseDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue(
        ARCHIVE_CONTEXT,
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'preview_archive_product', {
        product_id: 101,
      });

      expect(
        deps.productsService.findProductArchivePreviewForAgent,
      ).toHaveBeenCalledWith(101);
      expect(answer).toEqual({
        product: {
          product_id: 101,
          name: 'Coca Cola 1L (COCA-1L)',
          state: 'active',
        },
        requires_confirmation: true,
        confirmed_total_units: 42,
        confirmed_total_value: 126000,
        total_units: 42,
        total_value: 126000,
        zero_cost_units: 0,
        lines: [
          {
            location_id: 1,
            location: 'Bodega',
            product_variant_id: null,
            variant_sku: null,
            quantity_on_hand: 42,
            unit_cost: 3000,
            value: 126000,
            has_known_cost: true,
          },
        ],
        out_of_scope_units: 0,
        out_of_scope: [],
        has_active_reservations: false,
        archivable: true,
        next_step:
          'Pasa confirmed_total_units y confirmed_total_value tal cual a archive_product. Si el inventario se mueve, repite este preview.',
      });
    });

    it('(a) sad: product_id inválido → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'preview_archive_product', {
        product_id: 0,
      });

      expect(answer).toEqual({
        error: 'product_id inválido.',
        next_step:
          'Usa find_product para obtener el product_id antes de archivar.',
      });
      expect(
        deps.productsService.findProductArchivePreviewForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) producto archivable inexistente → {error, next_step}', async () => {
      const deps = baseDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue(
        { product: null, plan: null, hasActiveReservations: false },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'preview_archive_product', {
        product_id: 999,
      });

      expect(answer).toEqual({
        error:
          'No existe un producto archivable con id 999 en esta tienda (inexistente o ya archivado).',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
    });

    it('(c) bloqueado por reservas → archivable false con next_step', async () => {
      const deps = baseDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue(
        { ...ARCHIVE_CONTEXT, hasActiveReservations: true },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'preview_archive_product', {
        product_id: 101,
      });

      expect(answer.archivable).toBe(false);
      expect(answer.has_active_reservations).toBe(true);
      expect(answer.next_step).toContain('reservas activas');
    });
  });

  // ─── archive_product (O-4, write) ─────────────────────────────────────
  describe('archive_product', () => {
    const CHAIN_ARGS = {
      product_id: 101,
      confirmed_total_units: 42,
      confirmed_total_value: 126000,
    };

    function archiveDeps() {
      const deps = baseDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue(
        ARCHIVE_CONTEXT,
      );
      deps.productsService.remove.mockResolvedValue({
        id: 101,
        state: 'archived',
      });
      return deps;
    }

    it('(b) happy: snapshot exacto + remove con confirmación del castigo', async () => {
      const deps = archiveDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'archive_product', CHAIN_ARGS);

      // El token de Vexi ES la confirmación: el servicio recibe el flag.
      expect(deps.productsService.remove).toHaveBeenCalledWith(101, {
        confirm_stock_write_off: true,
      });
      expect(answer).toEqual({
        summary:
          'Coca Cola 1L (COCA-1L): archivado con baja de 42 unidades por 126000.',
        data: {
          product_id: 101,
          state: 'archived',
          write_off_units: 42,
          write_off_value: 126000,
        },
      });
    });

    it('(e) preview warning: irreversible con write-off detallado', async () => {
      const deps = archiveDeps();
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'archive_product', CHAIN_ARGS);

      // Este es el diff que el registry porta en AI_AGENT_005: la
      // verificación del paso 10 exige el write-off detallado acá.
      expect(result).toEqual({
        status: 'warning',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          { field: 'state', label: 'Estado', from: 'active', to: 'archived' },
          {
            field: 'stock_write_off_units',
            label: 'Unidades dadas de baja',
            from: 42,
            to: 0,
          },
          {
            field: 'stock_write_off_value',
            label: 'Valor dado de baja',
            from: 126000,
            to: 0,
          },
        ],
        message:
          'Archivado IRREVERSIBLE: da de baja 42 unidades por 126000 en 1 ubicación(es).',
        domain: 'products',
      });
      expect(deps.productsService.remove).not.toHaveBeenCalled();
    });

    it('(a) sad: sin cifras O-3 → error y cero llamadas (cadena dura)', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'archive_product', { product_id: 101 });

      expect(answer).toEqual({
        error:
          'Todo archivado exige preview_archive_product primero: llama a esa lectura y pasa sus confirmed_total_units y confirmed_total_value tal cual.',
        next_step:
          'Llama preview_archive_product con el product_id y reintenta con las cifras que devuelva.',
      });
      expect(
        deps.productsService.findProductArchivePreviewForAgent,
      ).not.toHaveBeenCalled();
      expect(deps.productsService.remove).not.toHaveBeenCalled();
    });

    it('(c) inventario movido → {error, next_step} repite preview', async () => {
      const deps = archiveDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'archive_product', {
        product_id: 101,
        confirmed_total_units: 40,
        confirmed_total_value: 120000,
      });

      expect(answer).toEqual({
        error:
          'El inventario se movió desde el preview (ahora: 42 unidades por 126000; aprobado: 40 por 120000).',
        next_step:
          'Repite preview_archive_product para cotizar con el estado actual y reintenta.',
      });
      expect(deps.productsService.remove).not.toHaveBeenCalled();
    });

    it('(c) reservas activas → {error, next_step} sin archivar', async () => {
      const deps = archiveDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue(
        { ...ARCHIVE_CONTEXT, hasActiveReservations: true },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'archive_product', CHAIN_ARGS);

      expect(answer.error).toContain('reservas de stock activas');
      expect(answer.next_step).toContain('preview_archive_product');
      expect(deps.productsService.remove).not.toHaveBeenCalled();
    });

    it('(c) existencias fuera de alcance → {error} sin archivar', async () => {
      const deps = archiveDeps();
      deps.productsService.findProductArchivePreviewForAgent.mockResolvedValue({
        ...ARCHIVE_CONTEXT,
        plan: {
          ...ARCHIVE_CONTEXT.plan,
          out_of_scope_units: 7,
          out_of_scope: [
            {
              location_id: 9,
              location_name: 'Bodega central',
              store_id: null,
              quantity_on_hand: 7,
            },
          ],
        },
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'archive_product', CHAIN_ARGS);

      expect(answer).toEqual({
        error:
          'El producto tiene 7 unidades en ubicaciones fuera de esta tienda (Bodega central). Transfiérelas o ajústalas desde Inventario antes de archivarlo.',
      });
      expect(deps.productsService.remove).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error} con mensaje, nunca throw', async () => {
      const deps = archiveDeps();
      deps.productsService.remove.mockRejectedValue(
        new Error('transacción abortada'),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'archive_product', CHAIN_ARGS);

      expect(answer).toEqual({
        error: 'No se pudo archivar el producto: transacción abortada',
      });
    });
  });

  // ─── manage_product_images (O-5, write) ───────────────────────────────
  describe('manage_product_images', () => {
    const IMAGE_URL = 'products/101/foto-principal.jpg';

    it('(b) happy add: snapshot exacto + delega en addImage', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.addImage.mockResolvedValue({ id: 55 });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_product_images', {
        action: 'add',
        product_id: 101,
        image_url: IMAGE_URL,
        is_main: true,
      });

      expect(deps.productsService.addImage).toHaveBeenCalledWith(101, {
        image_url: IMAGE_URL,
        is_main: true,
      });
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): imagen agregada.',
        data: { product_id: 101, image_id: 55, is_main: true },
      });
    });

    it('(e) preview add ok nombra al producto con la URL', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'manage_product_images', {
        action: 'add',
        product_id: 101,
        image_url: IMAGE_URL,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          {
            field: 'images',
            label: 'Imagen agregada',
            from: null,
            to: IMAGE_URL,
          },
        ],
        domain: 'products',
      });
      expect(deps.productsService.addImage).not.toHaveBeenCalled();
    });

    it('(b) happy remove: snapshot exacto + delega en removeImage', async () => {
      const deps = baseDeps();
      deps.productsService.findProductImageForAgent.mockResolvedValue({
        id: 55,
        product_id: 101,
        image_url: IMAGE_URL,
        is_main: false,
        product: ACTIVE_PRODUCT_ROW,
      });
      deps.productsService.removeImage.mockResolvedValue({ id: 55 });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_product_images', {
        action: 'remove',
        image_id: 55,
      });

      expect(deps.productsService.removeImage).toHaveBeenCalledWith(55);
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): imagen 55 eliminada.',
        data: { image_id: 55, deleted: true },
      });
    });

    it('(e) preview remove warning: avisa el borrado en S3', async () => {
      const deps = baseDeps();
      deps.productsService.findProductImageForAgent.mockResolvedValue({
        id: 55,
        product_id: 101,
        image_url: IMAGE_URL,
        is_main: false,
        product: ACTIVE_PRODUCT_ROW,
      });
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'manage_product_images', {
        action: 'remove',
        image_id: 55,
      });

      expect(result).toEqual({
        status: 'warning',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          {
            field: 'images',
            label: 'Imagen eliminada',
            from: IMAGE_URL,
            to: null,
          },
        ],
        message: 'Al confirmar se borra también el archivo de imagen guardado.',
        domain: 'products',
      });
      expect(deps.productsService.removeImage).not.toHaveBeenCalled();
    });

    it('(a) sad: action inválida → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'manage_product_images', {
        action: 'rotate',
      });

      expect(answer).toEqual({
        error: 'action "rotate" inválida. Usa add (agregar) o remove (quitar).',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.addImage).not.toHaveBeenCalled();
      expect(deps.productsService.removeImage).not.toHaveBeenCalled();
    });

    it('(a) sad: add sin image_url → error sin leer el producto', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'manage_product_images', {
        action: 'add',
        product_id: 101,
      });

      expect(answer).toEqual({
        error: 'image_url es obligatoria para agregar una imagen.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.addImage).not.toHaveBeenCalled();
    });

    it('(c) add en producto inactivo → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue({
        ...ACTIVE_PRODUCT_ROW,
        state: 'inactive',
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_product_images', {
        action: 'add',
        product_id: 101,
        image_url: IMAGE_URL,
      });

      expect(answer).toEqual({
        error:
          'El producto está en estado "inactive": solo los productos activos admiten imágenes nuevas.',
      });
      expect(deps.productsService.addImage).not.toHaveBeenCalled();
    });

    it('(c) remove de imagen inexistente → {error, next_step}', async () => {
      const deps = baseDeps();
      deps.productsService.findProductImageForAgent.mockResolvedValue(null);
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_product_images', {
        action: 'remove',
        image_id: 999,
      });

      expect(answer).toEqual({
        error: 'No existe una imagen con id 999 en esta tienda.',
        next_step:
          'Llama a get_product para ver las imágenes del producto y sus ids.',
      });
      expect(deps.productsService.removeImage).not.toHaveBeenCalled();
    });
  });

  // ─── get_product_promotions (O-6, read) ───────────────────────────────
  describe('get_product_promotions', () => {
    const PROMOS = [
      {
        id: 3,
        name: '2x1 gaseosas',
        type: 'buy_x_get_y',
        value: 50,
        state: 'active',
        start_date: '2026-09-01T00:00:00.000Z',
        end_date: '2026-09-30T00:00:00.000Z',
      },
    ];

    it('(b) happy: snapshot exacto de promociones aplicadas', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.getProductPromotions.mockResolvedValue(PROMOS);
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'get_product_promotions', {
        product_id: 101,
      });

      expect(deps.productsService.getProductPromotions).toHaveBeenCalledWith(
        101,
      );
      expect(answer).toEqual({
        product: {
          product_id: 101,
          name: 'Coca Cola 1L',
          sku: 'COCA-1L',
          state: 'active',
        },
        promotion_count: 1,
        promotions: [
          {
            promotion_id: 3,
            name: '2x1 gaseosas',
            type: 'buy_x_get_y',
            value: 50,
            state: 'active',
            start_date: '2026-09-01T00:00:00.000Z',
            end_date: '2026-09-30T00:00:00.000Z',
          },
        ],
        next_step:
          'Para cambiar a qué promociones pertenece usa set_product_promotions con la lista completa de promotion_ids (la asignación reemplaza, no suma).',
      });
    });

    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_product_promotions',
        { product_id: 101 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: las promociones se leen siempre dentro de una tienda.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.getProductPromotions).not.toHaveBeenCalled();
    });

    it('(a) sad: product_id inválido → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_product_promotions', {
        product_id: -2,
      });

      expect(answer).toEqual({
        error:
          'product_id inválido. Resuelve el producto con find_product antes de pedir sus promociones.',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(deps.productsService.getProductPromotions).not.toHaveBeenCalled();
    });

    it('(c) producto inexistente → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findOne.mockRejectedValue(new Error('no existe'));

      const answer = await run(tools, 'get_product_promotions', {
        product_id: 999,
      });

      expect(answer).toEqual({
        error: 'No existe un producto con id 999 en esta tienda.',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
      expect(deps.productsService.getProductPromotions).not.toHaveBeenCalled();
    });
  });

  // ─── set_product_promotions (O-7, write) ──────────────────────────────
  describe('set_product_promotions', () => {
    function promosDeps() {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.findPromotionsByIdsForAgent.mockResolvedValue([
        { id: 3, name: '2x1 gaseosas', type: 'buy_x_get_y', state: 'active' },
        { id: 5, name: 'Navidad', type: 'discount', state: 'active' },
      ]);
      deps.productsService.getProductPromotions.mockResolvedValue([
        { id: 7, name: 'Promo vieja' },
      ]);
      deps.productsService.updateProductPromotions.mockResolvedValue([
        { id: 3, name: '2x1 gaseosas' },
        { id: 5, name: 'Navidad' },
      ]);
      return deps;
    }

    it('(b) happy: snapshot exacto + reemplaza la asignación', async () => {
      const deps = promosDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_promotions', {
        product_id: 101,
        promotion_ids: [3, 5],
      });

      expect(
        deps.productsService.updateProductPromotions,
      ).toHaveBeenCalledWith(101, [3, 5]);
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): ahora pertenece a 2 promoción(es).',
        data: { product_id: 101, promotion_ids: [3, 5] },
      });
    });

    it('(e) preview ok nombra al producto con promociones from→to', async () => {
      const deps = promosDeps();
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'set_product_promotions', {
        product_id: 101,
        promotion_ids: [3, 5],
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          {
            field: 'promotion_ids',
            label: 'Promociones',
            from: ['Promo vieja'],
            to: ['2x1 gaseosas', 'Navidad'],
          },
        ],
        domain: 'products',
      });
      expect(
        deps.productsService.updateProductPromotions,
      ).not.toHaveBeenCalled();
    });

    it('(b) happy: lista vacía quita todas (to null)', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.findPromotionsByIdsForAgent.mockResolvedValue([]);
      deps.productsService.getProductPromotions.mockResolvedValue([
        { id: 7, name: 'Promo vieja' },
      ]);
      deps.productsService.updateProductPromotions.mockResolvedValue([]);
      const { tools } = buildTools(deps);

      const result = await previewTool(tools, 'set_product_promotions', {
        product_id: 101,
        promotion_ids: [],
      });

      expect(result.status).toBe('ok');
      expect(result.changes).toEqual([
        {
          field: 'promotion_ids',
          label: 'Promociones',
          from: ['Promo vieja'],
          to: null,
        },
      ]);
    });

    it('(a) sad: promotion_ids no es arreglo → error sin leer nada', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'set_product_promotions', {
        product_id: 101,
        promotion_ids: '3',
      });

      expect(answer).toEqual({
        error:
          'promotion_ids debe ser un arreglo de ids (vacío para quitar todas las promociones).',
      });
      expect(deps.productsService.findOne).not.toHaveBeenCalled();
      expect(
        deps.productsService.updateProductPromotions,
      ).not.toHaveBeenCalled();
    });

    it('(c) promoción inexistente → {error, next_step} sin escribir', async () => {
      const deps = baseDeps();
      deps.productsService.findOne.mockResolvedValue(ACTIVE_PRODUCT_ROW);
      deps.productsService.findPromotionsByIdsForAgent.mockResolvedValue([
        { id: 3, name: '2x1 gaseosas', type: 'buy_x_get_y', state: 'active' },
      ]);
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_promotions', {
        product_id: 101,
        promotion_ids: [3, 999],
      });

      expect(answer).toEqual({
        error: 'No existen promociones con id 999 en esta tienda.',
        next_step:
          'Pide al usuario los nombres de las promociones vigentes antes de reintentar.',
      });
      expect(
        deps.productsService.updateProductPromotions,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── generate_online_purchase_link (O-8, write) ───────────────────────
  describe('generate_online_purchase_link', () => {
    const PENDING_URL = 'https://tienda.vendix.com/products/coca-cola-1l';

    function linkDeps() {
      const deps = baseDeps();
      deps.productsService.findOnlinePurchaseContextForAgent.mockResolvedValue(
        {
          product: {
            id: 101,
            name: 'Coca Cola 1L',
            sku: 'COCA-1L',
            online_purchase_url: null,
            online_purchase_generated_at: null,
          },
          ready: true,
          reason: 'ready',
          message: 'ok',
          pending_url: PENDING_URL,
        },
      );
      deps.productsService.generateOnlinePurchaseLink.mockResolvedValue({
        generated: true,
        product_id: 101,
        online_purchase_url: PENDING_URL,
        online_purchase_qr_code: 'data:image/png;base64,iVBORw0KGgo=',
        online_purchase_domain_id: 9,
        domain_hostname: 'tienda.vendix.com',
        online_purchase_generated_at: '2026-09-29T00:00:00.000Z',
      });
      return deps;
    }

    it('(b) happy: snapshot exacto sin tokens internos ni QR en base64', async () => {
      const deps = linkDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'generate_online_purchase_link', {
        product_id: 101,
      });

      expect(
        deps.productsService.generateOnlinePurchaseLink,
      ).toHaveBeenCalledWith(101);
      // `toEqual` exacto: si el domain_id interno o el QR en base64 se
      // colaran en la respuesta, esta prueba falla a propósito.
      expect(answer).toEqual({
        summary: 'Coca Cola 1L (COCA-1L): enlace de compra generado.',
        data: {
          product_id: 101,
          online_purchase_url: PENDING_URL,
          domain_hostname: 'tienda.vendix.com',
          online_purchase_generated_at: '2026-09-29T00:00:00.000Z',
          qr_available: true,
        },
        next_step:
          'El QR quedó guardado en la ficha del producto, listo para mostrar o imprimir.',
      });
    });

    it('(e) preview ok nombra al producto con la URL que va a quedar', async () => {
      const deps = linkDeps();
      const { tools } = buildTools(deps);

      const result = await previewTool(
        tools,
        'generate_online_purchase_link',
        { product_id: 101 },
      );

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L)',
        changes: [
          {
            field: 'online_purchase_url',
            label: 'Enlace de compra',
            from: null,
            to: PENDING_URL,
          },
        ],
        message:
          'El QR se genera junto con el enlace y queda en la ficha del producto.',
        domain: 'products',
      });
      expect(
        deps.productsService.generateOnlinePurchaseLink,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'generate_online_purchase_link',
        { product_id: 101 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los enlaces de compra se generan siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findOnlinePurchaseContextForAgent,
      ).not.toHaveBeenCalled();
      expect(
        deps.productsService.generateOnlinePurchaseLink,
      ).not.toHaveBeenCalled();
    });

    it('(c) tienda en línea no lista → {error, next_step} sin generar', async () => {
      const deps = baseDeps();
      deps.productsService.findOnlinePurchaseContextForAgent.mockResolvedValue(
        {
          product: {
            id: 101,
            name: 'Coca Cola 1L',
            sku: 'COCA-1L',
            online_purchase_url: null,
            online_purchase_generated_at: null,
          },
          ready: false,
          reason: 'ecommerce_not_configured',
          message:
            'Configura y activa la tienda online antes de generar el QR de compra.',
          pending_url: null,
        },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'generate_online_purchase_link', {
        product_id: 101,
      });

      expect(answer).toEqual({
        error:
          'Configura y activa la tienda online antes de generar el QR de compra.',
        next_step:
          'Configura y activa la tienda en línea (dominio primario activo) y vuelve a intentarlo.',
      });
      expect(
        deps.productsService.generateOnlinePurchaseLink,
      ).not.toHaveBeenCalled();
    });
  });
});
