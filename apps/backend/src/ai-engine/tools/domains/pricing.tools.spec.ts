import { createPricingTools, PricingToolDeps } from './pricing.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * O-12/O-13 — Spec de contrato de la familia pricing (patrón canónico T4).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) circuito de escritura: los 2 son writes con `requiresConfirmation` +
 *     `preview` con sujeto humano, y el handler re-verifica (el preview es
 *     proyección, no transacción). Si mañana se agrega otra tool, el bloque
 *     de registro falla a propósito y obliga a extender la spec.
 *
 * Reglas de dominio pinneadas: multi-tarifa ⊕ variantes (una presentación
 * `sale_unit` sobre un producto con variantes no procede) y nunca
 * `final_price` en los parámetros (es un calculado de lectura).
 */
describe('pricing.tools · contrato canónico T4', () => {
  const STORE_ID = 7;

  const TIER_ROW = {
    id: 11,
    name: 'Bulto x50',
    kind: 'sale_unit',
    code: 'B50',
    description: null,
    discount_percentage: 5,
    is_active: true,
    is_default: false,
    is_package_unit: true,
    units_per_package: 50,
    sort_order: 1,
  };

  const PRODUCT_CONTEXT = {
    product: {
      id: 101,
      name: 'Coca Cola 1L',
      sku: 'COCA-1L',
      state: 'active',
      product_type: 'physical',
      track_inventory: true,
    },
    variants: [],
    baseHasActiveReservations: false,
    recipeComponentCount: 0,
  };

  function baseDeps() {
    return {
      priceTiersService: {
        create: jest.fn(),
        findAll: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
        softDelete: jest.fn(),
        restore: jest.fn(),
        findOverridesByProduct: jest.fn(),
        upsertProductOverride: jest.fn(),
        removeProductOverride: jest.fn(),
      } as any,
      productsService: {
        findProductVariantWriteContextForAgent: jest.fn(),
      } as any,
      productsBulkEditService: {
        preview: jest.fn(),
        apply: jest.fn(),
        listActiveProductIds: jest.fn(),
      } as any,
    } satisfies PricingToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createPricingTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool) throw new Error(`${name} no registrado`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.handler) throw new Error(`${name} sin handler`);
    return JSON.parse(await tool.handler(args, context as any));
  };

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente las tools de pricing', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'preview_product_price_tiers',
        'manage_product_price_tiers',
        'manage_price_tiers',
        'set_product_tier_override',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('pricing');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada write exige los permisos de sus verbos HTTP', () => {
      const { tools } = buildTools();
      // Unión de los verbos que cubre (precedente manage_purchase_orders):
      // create→create, update/restore→update, deactivate→delete.
      expect(
        getTool(tools, 'manage_price_tiers').requiredPermissions,
      ).toEqual([
        'store:price-tiers:create',
        'store:price-tiers:update',
        'store:price-tiers:delete',
      ]);
      // Upsert y borrado de override usan el PUT/DELETE con :update.
      expect(
        getTool(tools, 'set_product_tier_override').requiredPermissions,
      ).toEqual(['store:price-tiers:update']);
    });

    it('los writes tienen circuito completo (confirmación + preview)', () => {
      const { tools } = buildTools();
      for (const tool of tools.filter((t) => t.readOnly !== true)) {
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums; jamás final_price', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'manage_price_tiers').parameters.required,
      ).toEqual(['action']);
      expect(
        getTool(tools, 'manage_price_tiers').parameters.properties.action.enum,
      ).toEqual(['create', 'update', 'deactivate', 'restore']);
      expect(
        getTool(tools, 'manage_price_tiers').parameters.properties.kind.enum,
      ).toEqual(['customer_tier', 'sale_unit']);
      expect(
        getTool(tools, 'set_product_tier_override').parameters.required,
      ).toEqual(['product_id', 'price_tier_id']);
      expect(
        getTool(tools, 'set_product_tier_override').parameters.properties
          .action.enum,
      ).toEqual(['set', 'clear']);
      // `final_price` es un calculado de lectura: ninguna escritura de
      // pricing lo acepta.
      expect(
        getTool(tools, 'manage_price_tiers').parameters.properties.final_price,
      ).toBeUndefined();
      expect(
        getTool(tools, 'set_product_tier_override').parameters.properties
          .final_price,
      ).toBeUndefined();
      expect(
        getTool(tools, 'set_product_tier_override').parameters.properties
          .base_price,
      ).toBeUndefined();
    });
  });

  // ─── manage_price_tiers (O-12) ────────────────────────────────────────
  describe('manage_price_tiers', () => {
    it('(b) happy create: snapshot exacto + delega en create', async () => {
      const deps = baseDeps();
      deps.priceTiersService.create.mockResolvedValue({
        ...TIER_ROW,
        id: 12,
        name: 'Caja x12',
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'create',
        name: 'Caja x12',
        kind: 'sale_unit',
        units_per_package: 12,
      });

      expect(deps.priceTiersService.create).toHaveBeenCalledWith({
        name: 'Caja x12',
        kind: 'sale_unit',
        units_per_package: 12,
      });
      expect(answer).toEqual({
        summary: 'Tarifa "Caja x12": tarifa creada.',
        data: { price_tier_id: 12, name: 'Caja x12' },
      });
    });

    it('(e) preview create ok nombra la tarifa con from null', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'manage_price_tiers', {
        action: 'create',
        name: 'Caja x12',
        kind: 'sale_unit',
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Tarifa "Caja x12"',
        changes: [
          { field: 'name', label: 'Nombre', from: null, to: 'Caja x12' },
          { field: 'kind', label: 'Eje', from: null, to: 'sale_unit' },
        ],
        message:
          'Al confirmar se crea la tarifa en la tienda; para que los productos la usen, asígnala con manage_product_price_tiers (precio propio por producto: set_product_tier_override).',
        domain: 'pricing',
      });
      // El preview es solo lectura: no escribe.
      expect(deps.priceTiersService.create).not.toHaveBeenCalled();
    });

    it('(b) happy update: snapshot exacto + PATCH solo con lo enviado', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(TIER_ROW);
      deps.priceTiersService.update.mockResolvedValue({
        ...TIER_ROW,
        discount_percentage: 8,
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'update',
        price_tier_id: 11,
        discount_percentage: 8,
      });

      expect(deps.priceTiersService.update).toHaveBeenCalledWith(11, {
        discount_percentage: 8,
      });
      expect(answer).toEqual({
        summary: 'Tarifa "Bulto x50": 1 campo(s) actualizado(s).',
        data: { price_tier_id: 11, updated_fields: ['discount_percentage'] },
      });
    });

    it('(e) preview update ok con from→to y dominio', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(TIER_ROW);
      const { tools } = buildTools(deps);

      const result = await preview(tools, 'manage_price_tiers', {
        action: 'update',
        price_tier_id: 11,
        discount_percentage: 8,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Tarifa "Bulto x50"',
        changes: [
          {
            field: 'discount_percentage',
            label: 'Descuento (%)',
            from: 5,
            to: 8,
          },
        ],
        domain: 'pricing',
      });
      expect(deps.priceTiersService.update).not.toHaveBeenCalled();
    });

    it('(b) happy deactivate + restore: delegan en softDelete/restore', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(TIER_ROW);
      deps.priceTiersService.softDelete.mockResolvedValue({
        ...TIER_ROW,
        is_active: false,
      });
      const { tools } = buildTools(deps);

      const off = await run(tools, 'manage_price_tiers', {
        action: 'deactivate',
        price_tier_id: 11,
      });

      expect(deps.priceTiersService.softDelete).toHaveBeenCalledWith(11);
      expect(off).toEqual({
        summary: 'Tarifa "Bulto x50": desactivada.',
        data: { price_tier_id: 11, is_active: false },
      });

      deps.priceTiersService.findOne.mockResolvedValue({
        ...TIER_ROW,
        is_active: false,
      });
      deps.priceTiersService.restore.mockResolvedValue(TIER_ROW);
      const on = await run(tools, 'manage_price_tiers', {
        action: 'restore',
        price_tier_id: 11,
      });

      expect(deps.priceTiersService.restore).toHaveBeenCalledWith(11);
      expect(on).toEqual({
        summary: 'Tarifa "Bulto x50": reactivada.',
        data: { price_tier_id: 11, is_active: true },
      });
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'manage_price_tiers',
        { action: 'create', name: 'X' },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: las tarifas se gestionan siempre dentro de una tienda.',
      });
      expect(deps.priceTiersService.create).not.toHaveBeenCalled();
      expect(deps.priceTiersService.findOne).not.toHaveBeenCalled();
    });

    it('(a) sad: action inválida → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'archive',
      });

      expect(answer).toEqual({
        error:
          'action "archive" inválida. Usa create, update, deactivate o restore.',
      });
      expect(deps.priceTiersService.create).not.toHaveBeenCalled();
      expect(deps.priceTiersService.findOne).not.toHaveBeenCalled();
    });

    it('(a) sad: create sin name → error sin escribir', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'create',
      });

      expect(answer).toEqual({
        error:
          'name es obligatorio para crear una tarifa ("Bulto x50", "Mayorista").',
      });
      expect(deps.priceTiersService.create).not.toHaveBeenCalled();
    });

    it('(c) tarifa inexistente → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockRejectedValue(new Error('no existe'));
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'update',
        price_tier_id: 999,
        name: 'X',
      });

      expect(answer).toEqual({
        error: 'No existe una tarifa con id 999 en esta tienda.',
      });
      expect(deps.priceTiersService.update).not.toHaveBeenCalled();
    });

    it('(c) update sin cambios → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(TIER_ROW);
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'update',
        price_tier_id: 11,
      });

      expect(answer).toEqual({
        error:
          'No hay cambios: indica al menos un campo a editar (name, discount_percentage, units_per_package…).',
      });
      expect(deps.priceTiersService.update).not.toHaveBeenCalled();
    });

    it('(c) deactivate ya inactiva → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue({
        ...TIER_ROW,
        is_active: false,
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'deactivate',
        price_tier_id: 11,
      });

      expect(answer).toEqual({
        error: 'La tarifa ya está desactivada: no hay nada que cambiar.',
      });
      expect(deps.priceTiersService.softDelete).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error} con mensaje, nunca throw', async () => {
      const deps = baseDeps();
      deps.priceTiersService.create.mockRejectedValue(
        new Error('Ya existe una tarifa con ese nombre'),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'manage_price_tiers', {
        action: 'create',
        name: 'Bulto x50',
      });

      expect(answer).toEqual({
        error:
          'No se pudo gestionar la tarifa: Ya existe una tarifa con ese nombre',
      });
    });
  });

  // ─── set_product_tier_override (O-13) ─────────────────────────────────
  describe('set_product_tier_override', () => {
    function overrideDeps() {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(TIER_ROW);
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        PRODUCT_CONTEXT,
      );
      deps.priceTiersService.findOverridesByProduct.mockResolvedValue([]);
      deps.priceTiersService.upsertProductOverride.mockResolvedValue({
        id: 77,
      });
      return deps;
    }

    it('(b) happy set: snapshot exacto + delega en upsert', async () => {
      const deps = overrideDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        override_price: 240000,
      });

      expect(
        deps.priceTiersService.upsertProductOverride,
      ).toHaveBeenCalledWith(101, 11, { override_price: 240000 });
      expect(answer).toEqual({
        summary:
          'Coca Cola 1L (COCA-1L) — Bulto x50: precio por tarifa guardado.',
        data: {
          product_id: 101,
          price_tier_id: 11,
          variant_id: null,
          updated_fields: ['override_price'],
        },
      });
    });

    it('(e) preview set ok nombra producto + tarifa con from→to', async () => {
      const deps = overrideDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        override_price: 240000,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola 1L (COCA-1L) — Bulto x50',
        changes: [
          {
            field: 'override_price',
            label: 'Precio del paquete',
            from: null,
            to: 240000,
          },
        ],
        domain: 'pricing',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(b) happy clear: quita el precio propio y rige la regla general', async () => {
      const deps = overrideDeps();
      deps.priceTiersService.findOverridesByProduct.mockResolvedValue([
        {
          id: 77,
          product_id: 101,
          price_tier_id: 11,
          variant_id: null,
          override_price: 240000,
          override_units_per_package: null,
          override_profit_margin: null,
          is_default: false,
          barcode: null,
        },
      ]);
      deps.priceTiersService.removeProductOverride.mockResolvedValue({
        deleted: true,
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        action: 'clear',
        product_id: 101,
        price_tier_id: 11,
      });

      expect(
        deps.priceTiersService.removeProductOverride,
      ).toHaveBeenCalledWith(101, 11, undefined);
      expect(answer).toEqual({
        summary:
          'Coca Cola 1L (COCA-1L) — Bulto x50: precio propio eliminado, rige la regla general.',
        data: {
          product_id: 101,
          price_tier_id: 11,
          variant_id: null,
          cleared: true,
        },
      });
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'set_product_tier_override',
        { product_id: 101, price_tier_id: 11, override_price: 1 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los precios por tarifa se fijan siempre dentro de una tienda.',
      });
      expect(deps.priceTiersService.findOne).not.toHaveBeenCalled();
      expect(
        deps.productsService.findProductVariantWriteContextForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) multi-tarifa ⊕ variantes: sale_unit con variantes no procede', async () => {
      const deps = overrideDeps();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        {
          ...PRODUCT_CONTEXT,
          variants: [
            { id: 201, name: 'Talla M', sku: 'COCA-M' },
            { id: 202, name: 'Talla L', sku: 'COCA-L' },
          ],
        },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        override_price: 240000,
      });

      expect(answer).toEqual({
        error:
          'Este producto tiene 2 variante(s). Multi-tarifa y variantes son excluyentes: elimina las variantes para poder venderlo en la presentación "Bulto x50".',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) customer_tier con variantes sí procede (la exclusión es solo sale_unit)', async () => {
      const deps = overrideDeps();
      deps.priceTiersService.findOne.mockResolvedValue({
        ...TIER_ROW,
        kind: 'customer_tier',
        name: 'Mayorista',
      });
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        {
          ...PRODUCT_CONTEXT,
          variants: [{ id: 201, name: 'Talla M', sku: 'COCA-M' }],
        },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        override_price: 4500,
      });

      expect(
        deps.priceTiersService.upsertProductOverride,
      ).toHaveBeenCalledWith(101, 11, { override_price: 4500 });
      expect(answer.summary).toContain('precio por tarifa guardado');
    });

    it('(c) is_default en tarifa no sale_unit → {error} sin escribir', async () => {
      const deps = overrideDeps();
      deps.priceTiersService.findOne.mockResolvedValue({
        ...TIER_ROW,
        kind: 'customer_tier',
        name: 'Mayorista',
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        is_default: true,
      });

      expect(answer).toEqual({
        error:
          'Solo una tarifa de tipo sale_unit puede ser presentación por defecto; "Mayorista" es nivel de cliente.',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) variante ajena al producto → {error, next_step}', async () => {
      const deps = overrideDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        variant_id: 999,
        override_price: 240000,
      });

      expect(answer).toEqual({
        error: 'La variante 999 no pertenece al producto 101.',
        next_step:
          'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) set sin campos → {error} sin escribir', async () => {
      const deps = overrideDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
      });

      expect(answer).toEqual({
        error:
          'No hay cambios: indica al menos un campo (override_price, override_units_per_package, override_profit_margin, is_default, barcode).',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) clear sin override existente → {error} sin escribir', async () => {
      const deps = overrideDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        action: 'clear',
        product_id: 101,
        price_tier_id: 11,
      });

      expect(answer).toEqual({
        error:
          'El producto no tiene precio propio en esta tarifa: no hay nada que quitar (ya rige la regla general).',
      });
      expect(
        deps.priceTiersService.removeProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) tarifa inexistente → {error} sin escribir', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockRejectedValue(new Error('no existe'));
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 999,
        override_price: 1,
      });

      expect(answer).toEqual({
        error: 'No existe una tarifa con id 999 en esta tienda.',
      });
      expect(
        deps.priceTiersService.upsertProductOverride,
      ).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error} con mensaje, nunca throw', async () => {
      const deps = overrideDeps();
      deps.priceTiersService.upsertProductOverride.mockRejectedValue(
        new Error('conflicto de unicidad'),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'set_product_tier_override', {
        product_id: 101,
        price_tier_id: 11,
        override_price: 240000,
      });

      expect(answer).toEqual({
        error: 'No se pudo guardar el precio por tarifa: conflicto de unicidad',
      });
    });
  });

  // ─── T1/T2: asignación masiva de una tarifa (bulk-edit) ───────────────
  describe('preview_product_price_tiers + manage_product_price_tiers', () => {
    const MANAURE = { ...TIER_ROW, id: 21, name: 'Manaure', kind: 'customer_tier' };
    const ALL_IDS = Array.from({ length: 68 }, (_, i) => i + 1);
    const HAVE_IT = new Set(ALL_IDS.slice(0, 12));

    /** Réplica del preview del bulk-edit: 12 ya la tienen, 56 cambian. */
    function bulkPreviewFor(dto: any, opts: { conflicts?: number[] } = {}) {
      const items = dto.ids.map((id: number) => {
        const base = { id, name: `Producto ${id}`, sku: null };
        if (opts.conflicts?.includes(id)) {
          return {
            ...base,
            status: 'error',
            changes: [],
            code: 'PRODUCT_TIERS_VARIANTS_EXCLUSIVE',
            message: 'Este producto tiene 2 variantes.',
          };
        }
        const changes = HAVE_IT.has(id)
          ? []
          : [{ field: 'price_tiers', current: [], next: [{ id: 21, name: 'Manaure' }] }];
        return { ...base, status: 'ok', changes };
      });
      return { total: items.length, ok: items.length, warnings: 0, errors: 0, items };
    }

    function depsWithStore(opts: { conflicts?: number[] } = {}) {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue(MANAURE);
      deps.productsBulkEditService.listActiveProductIds.mockResolvedValue(ALL_IDS);
      deps.productsBulkEditService.preview.mockImplementation(async (dto: any) =>
        bulkPreviewFor(dto, opts),
      );
      return deps;
    }

    it('registro: lectura sin confirmación y escritura con permisos del bulk-edit', () => {
      const { tools } = buildTools();
      const read = getTool(tools, 'preview_product_price_tiers');
      expect(read.readOnly).toBe(true);
      expect(read.requiresConfirmation ?? false).toBe(false);
      expect(read.requiredPermissions).toEqual([
        'store:products:read',
        'store:price-tiers:read',
      ]);
      const write = getTool(tools, 'manage_product_price_tiers');
      expect(write.requiresConfirmation).toBe(true);
      expect(write.requiredPermissions).toEqual([
        'store:products:bulk_update',
        'store:price-tiers:update',
      ]);
      expect(write.parameters.required).toEqual(['price_tier_id', 'product_ids']);
      expect(write.parameters.properties.action.enum).toEqual(['assign', 'remove']);
    });

    it('T2: 68 productos activos, 12 con la tarifa → faltan 56 y un solo paso de lote', async () => {
      const { deps, tools } = buildTools(depsWithStore());
      const out = await run(tools, 'preview_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(deps.productsBulkEditService.listActiveProductIds).toHaveBeenCalledWith(501);
      expect(deps.productsBulkEditService.preview).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: ALL_IDS,
          changes: expect.objectContaining({
            price_tier_action: { mode: 'add', ids: [21] },
          }),
        }),
      );
      expect(out.summary).toBe(
        'Tarifa "Manaure": 12 ya la tienen, 56 faltan, 0 en conflicto.',
      );
      expect(out.data).toMatchObject({
        scanned: 68,
        already: 12,
        pending: 56,
        conflicts: 0,
      });
      expect(out.data.batch_steps).toEqual([
        {
          tool: 'manage_product_price_tiers',
          arguments: {
            action: 'assign',
            price_tier_id: 21,
            product_ids: ALL_IDS.slice(12),
          },
          label: 'Asignar la tarifa "Manaure" a 56 productos',
        },
      ]);
      expect(deps.productsBulkEditService.apply).not.toHaveBeenCalled();
    });

    it('T2: los conflictos se cuentan aparte con su motivo', async () => {
      const { tools } = buildTools(depsWithStore({ conflicts: [13, 14] }));
      const out = await run(tools, 'preview_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(out.summary).toBe(
        'Tarifa "Manaure": 12 ya la tienen, 54 faltan, 2 en conflicto.',
      );
      expect(out.data.conflict_items[0]).toEqual({
        id: 13,
        name: 'Producto 13',
        reason: 'Este producto tiene 2 variantes.',
      });
      expect(out.data.batch_steps[0].arguments.product_ids).toHaveLength(54);
    });

    it('T2: más de 100 faltantes se parten en pasos de 100', async () => {
      const deps = depsWithStore();
      const many = Array.from({ length: 230 }, (_, i) => 1000 + i);
      deps.productsBulkEditService.listActiveProductIds.mockResolvedValue(many);
      const { tools } = buildTools(deps);
      const out = await run(tools, 'preview_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(deps.productsBulkEditService.preview).toHaveBeenCalledTimes(3);
      expect(
        out.data.batch_steps.map((s: any) => s.arguments.product_ids.length),
      ).toEqual([100, 100, 30]);
      expect(out.data.batch_steps[2].label).toBe(
        'Asignar la tarifa "Manaure" a 30 productos (parte 3 de 3)',
      );
    });

    it('T2: si ya la tienen todos, no ofrece pasos y prohíbe el lote vacío', async () => {
      const deps = depsWithStore();
      deps.productsBulkEditService.listActiveProductIds.mockResolvedValue(
        ALL_IDS.slice(0, 12),
      );
      const { tools } = buildTools(deps);
      const out = await run(tools, 'preview_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(out.summary).toBe(
        'Ya la tienen todos: los 12 producto(s) evaluados ya tienen la tarifa "Manaure". No hay nada que aplicar.',
      );
      expect(out.data.batch_steps).toEqual([]);
      expect(out.next_step).toBe(
        'Dile a la persona que no hay nada que aplicar. No propongas un lote.',
      );
    });

    it('T2: más de 500 productos activos → error guiado, sin preview', async () => {
      const deps = depsWithStore();
      deps.productsBulkEditService.listActiveProductIds.mockResolvedValue(
        Array.from({ length: 501 }, (_, i) => i + 1),
      );
      const { tools } = buildTools(deps);
      const out = await run(tools, 'preview_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(out.error).toContain('más de 500 productos activos');
      expect(deps.productsBulkEditService.preview).not.toHaveBeenCalled();
    });

    it('T1: preview de escritura lista un cambio por producto y el diff', async () => {
      const { tools } = buildTools(depsWithStore());
      const result = await preview(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: ALL_IDS,
      });
      expect(result.status).toBe('ok');
      expect(result.target).toBe('Tarifa "Manaure" en 56 producto(s)');
      expect(result.changes).toHaveLength(56);
      expect(result.changes[0]).toEqual({
        field: 'price_tiers',
        label: 'Producto 13',
        from: 'Sin la tarifa',
        to: 'Con "Manaure"',
      });
      expect(result.message).toBe('12 ya la tienen, 56 faltan, 0 en conflicto.');
    });

    it('T1: preview sin nada que cambiar es error (no acuña token ni lote vacío)', async () => {
      const { tools } = buildTools(depsWithStore());
      const result = await preview(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: ALL_IDS.slice(0, 12),
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('Ya la tienen todos');
    });

    it('T1: la escritura exige product_ids explícitos (no all_active_products)', async () => {
      const { deps, tools } = buildTools(depsWithStore());
      const result = await preview(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        all_active_products: true,
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('product_ids es obligatorio');
      expect(deps.productsBulkEditService.preview).not.toHaveBeenCalled();
    });

    it('T1: handler re-verifica y aplica solo los que cambian, con resultado por ítem', async () => {
      const deps = depsWithStore();
      deps.productsBulkEditService.apply.mockImplementation(async (dto: any) => ({
        total: dto.ids.length,
        successful: dto.ids.length - 1,
        failed: 1,
        results: dto.ids.map((id: number, i: number) =>
          i === 0
            ? { id, name: `Producto ${id}`, status: 'error', message: 'Archivado' }
            : { id, name: `Producto ${id}`, status: 'ok' },
        ),
      }));
      const { tools } = buildTools(deps);
      const out = await run(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: ALL_IDS,
      });
      expect(deps.productsBulkEditService.preview).toHaveBeenCalledTimes(1);
      expect(deps.productsBulkEditService.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: ALL_IDS.slice(12),
          changes: expect.objectContaining({
            price_tier_action: { mode: 'add', ids: [21] },
          }),
        }),
      );
      expect(out.summary).toBe(
        'Tarifa "Manaure": 55 aplicados, 1 fallidos, 12 ya estaban así.',
      );
      expect(out.data.failed_items).toEqual([
        { id: 13, name: 'Producto 13', reason: 'Archivado' },
      ]);
    });

    it('(a) sad: tarifa desactivada no se asigna y no toca el bulk-edit', async () => {
      const deps = baseDeps();
      deps.priceTiersService.findOne.mockResolvedValue({ ...MANAURE, is_active: false });
      const { tools } = buildTools(deps);
      const out = await run(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: [1, 2],
      });
      expect(out).toEqual({
        error: 'La tarifa "Manaure" está desactivada y no se puede asignar.',
        next_step: 'Reactívala primero con manage_price_tiers (action restore).',
      });
      expect(deps.productsBulkEditService.preview).not.toHaveBeenCalled();
      expect(deps.productsBulkEditService.apply).not.toHaveBeenCalled();
    });

    it('(a) sad: más de 100 product_ids en un paso → error guiado', async () => {
      const { deps, tools } = buildTools(depsWithStore());
      const out = await run(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: Array.from({ length: 101 }, (_, i) => i + 1),
      });
      expect(out.error).toBe('Son 101 productos y cada paso admite 100.');
      expect(deps.productsBulkEditService.apply).not.toHaveBeenCalled();
    });

    it('(c) si no se aplica ninguno, el handler devuelve {error} (no un éxito vacío)', async () => {
      const deps = depsWithStore();
      deps.productsBulkEditService.apply.mockResolvedValue({
        total: 1,
        successful: 0,
        failed: 1,
        results: [{ id: 20, name: 'Producto 20', status: 'error', message: 'Archivado' }],
      });
      const { tools } = buildTools(deps);
      const out = await run(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: [20],
      });
      expect(out).toEqual({
        error: 'Tarifa "Manaure": 0 aplicados, 1 fallidos. Producto 20: Archivado',
      });
    });

    it('(c) el bulk-edit lanza → {error} con mensaje, nunca throw', async () => {
      const deps = depsWithStore();
      deps.productsBulkEditService.apply.mockRejectedValue(new Error('db caída'));
      const { tools } = buildTools(deps);
      const out = await run(tools, 'manage_product_price_tiers', {
        price_tier_id: 21,
        product_ids: [20],
      });
      expect(out).toEqual({ error: 'No se pudo aplicar la tarifa: db caída' });
    });
  });
});
