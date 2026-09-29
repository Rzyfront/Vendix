import { ConflictException } from '@nestjs/common';
import { createVariantTools, VariantToolDeps } from './variants.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * O-9..O-11 — Spec de contrato de la familia variants (patrón canónico T4).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) circuito de escritura: los 3 son writes con `requiresConfirmation` +
 *     `preview` con sujeto humano, y el handler re-verifica (el preview es
 *     proyección, no transacción).
 */
describe('variants.tools · contrato canónico T4', () => {
  const STORE_ID = 7;

  function baseDeps() {
    return {
      productsService: {
        findProductVariantWriteContextForAgent: jest.fn(),
        findVariantWriteTargetForAgent: jest.fn(),
        createVariant: jest.fn(),
        updateVariant: jest.fn(),
        removeVariant: jest.fn(),
      } as any,
    } satisfies VariantToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createVariantTools(deps) };
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
    it('expone exactamente los 3 writes de variantes', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'create_variant',
        'update_variant',
        'delete_variant',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('products');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada write exige el permiso de su verbo HTTP', () => {
      const { tools } = buildTools();
      // Mismo verbo que el controlador: POST :id/variants → create,
      // PATCH variants/:variantId → update, DELETE variants/:variantId → delete.
      expect(getTool(tools, 'create_variant').requiredPermissions).toEqual([
        'store:products:create',
      ]);
      expect(getTool(tools, 'update_variant').requiredPermissions).toEqual([
        'store:products:update',
      ]);
      expect(getTool(tools, 'delete_variant').requiredPermissions).toEqual([
        'store:products:delete',
      ]);
    });

    it('los 3 son writes con circuito completo (confirmación + preview)', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums del JSON Schema', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'create_variant').parameters.required).toEqual([
        'product_id',
        'sku',
      ]);
      expect(getTool(tools, 'update_variant').parameters.required).toEqual([
        'product_variant_id',
      ]);
      expect(getTool(tools, 'delete_variant').parameters.required).toEqual([
        'product_variant_id',
      ]);
      expect(
        getTool(tools, 'create_variant').parameters.properties
          .service_pricing_type.enum,
      ).toEqual(['per_session', 'package', 'subscription']);
      // Las variantes usan `price_override`: jamás `base_price`.
      expect(
        getTool(tools, 'create_variant').parameters.properties.base_price,
      ).toBeUndefined();
      expect(
        getTool(tools, 'update_variant').parameters.properties.base_price,
      ).toBeUndefined();
    });
  });

  // ─── create_variant (O-9) ─────────────────────────────────────────────
  describe('create_variant', () => {
    const WRITE_CONTEXT = {
      product: {
        id: 101,
        name: 'Coca Cola',
        sku: 'COCA',
        state: 'active',
        product_type: 'physical',
        track_inventory: true,
      },
      variants: [{ id: 1, name: 'Pet 600ml', sku: 'COCA-600' }],
      baseHasActiveReservations: false,
      recipeComponentCount: 0,
    };

    function createDeps() {
      const deps = baseDeps();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        WRITE_CONTEXT,
      );
      deps.productsService.createVariant.mockResolvedValue({
        id: 2,
        sku: 'COCA-1L',
        name: 'Pet 1L',
      });
      return deps;
    }

    it('(b) happy: snapshot exacto + delega en productsService.createVariant', async () => {
      const deps = createDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
        name: 'Pet 1L',
        price_override: 5000,
      });

      expect(
        deps.productsService.findProductVariantWriteContextForAgent,
      ).toHaveBeenCalledWith(101);
      // `stock_quantity: 0` lo aporta el default del propio DTO
      // (`CreateProductVariantDto.stock_quantity = 0`), no el tool.
      expect(deps.productsService.createVariant).toHaveBeenCalledWith(101, {
        sku: 'COCA-1L',
        name: 'Pet 1L',
        price_override: 5000,
        stock_quantity: 0,
      });
      expect(answer).toEqual({
        summary: 'Variante "Pet 1L (SKU COCA-1L)" creada en "Coca Cola".',
        data: {
          product_id: 101,
          product_variant_id: 2,
          sku: 'COCA-1L',
          name: 'Pet 1L',
        },
        next_step:
          'Si la variante lleva stock en varias bodegas, muévelo con manage_stock_transfers.',
      });
    });

    it('(e) preview ok nombra producto y variante con dominio', async () => {
      const deps = createDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
        name: 'Pet 1L',
        price_override: 5000,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Pet 1L (SKU COCA-1L) en Coca Cola',
        changes: [
          { field: 'sku', label: 'SKU', from: null, to: 'COCA-1L' },
          { field: 'name', label: 'Nombre', from: null, to: 'Pet 1L' },
          {
            field: 'price_override',
            label: 'Precio propio (sin impuestos)',
            from: null,
            to: 5000,
          },
        ],
        message: 'Se crea la variante dentro del producto "Coca Cola".',
        domain: 'products',
      });
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'create_variant',
        { product_id: 101, sku: 'COCA-1L' },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: las variantes se crean siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findProductVariantWriteContextForAgent,
      ).not.toHaveBeenCalled();
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(a) sad: sin SKU → error sin leer ni escribir', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'create_variant', { product_id: 101 });

      expect(answer).toEqual({
        error:
          'El SKU de la variante es obligatorio y debe ser único dentro del producto.',
      });
      expect(
        deps.productsService.findProductVariantWriteContextForAgent,
      ).not.toHaveBeenCalled();
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) producto inexistente → {error, next_step} hacia find_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        {
          product: null,
          variants: [],
          baseHasActiveReservations: false,
          recipeComponentCount: 0,
        },
      );

      const answer = await run(tools, 'create_variant', {
        product_id: 999,
        sku: 'X-1',
      });

      expect(answer).toEqual({
        error: 'No existe un producto con id 999 en esta tienda.',
        next_step:
          'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      });
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) SKU duplicado en el producto → {error} sin escribir', async () => {
      const deps = createDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'coca-600',
      });

      expect(answer).toEqual({
        error: 'El SKU "coca-600" ya lo usa otra variante de "Coca Cola".',
        next_step: 'Elige un SKU distinto para esta variante.',
      });
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) producto inactivo → {error} sin escribir', async () => {
      const deps = createDeps();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        {
          ...WRITE_CONTEXT,
          product: { ...WRITE_CONTEXT.product, state: 'inactive' },
        },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
      });

      expect(answer.error).toContain(
        'solo los productos activos admiten variantes nuevas',
      );
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) insumo de receta → {error} sin escribir', async () => {
      const deps = createDeps();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        { ...WRITE_CONTEXT, recipeComponentCount: 2 },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
      });

      expect(answer.error).toContain(
        'se usa como insumo en 2 receta(s), así que no admite variantes',
      );
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) reservas activas en la base → {error} sin escribir', async () => {
      const deps = createDeps();
      deps.productsService.findProductVariantWriteContextForAgent.mockResolvedValue(
        { ...WRITE_CONTEXT, baseHasActiveReservations: true },
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
      });

      expect(answer.error).toContain(
        'tiene reservas de stock activas (pedidos en curso apartando unidades)',
      );
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) campos de servicio en producto físico → {error} sin escribir', async () => {
      const deps = createDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
        service_duration_minutes: 30,
      });

      expect(answer.error).toContain(
        'solo se aceptan en variantes de un producto de tipo servicio',
      );
      expect(deps.productsService.createVariant).not.toHaveBeenCalled();
    });

    it('(c) el service lanza (carrera de SKU) → {error} con mensaje, nunca throw', async () => {
      const deps = createDeps();
      deps.productsService.createVariant.mockRejectedValue(
        new ConflictException('El SKU de la variante ya está en uso'),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'create_variant', {
        product_id: 101,
        sku: 'COCA-1L',
      });

      expect(answer).toEqual({
        error:
          'No se pudo crear la variante: El SKU de la variante ya está en uso',
      });
    });
  });

  // ─── update_variant (O-10) ────────────────────────────────────────────
  describe('update_variant', () => {
    const WRITE_TARGET = {
      variant: {
        id: 2,
        product_id: 101,
        name: 'Pet 1L',
        sku: 'COCA-1L',
        barcode: null,
        price_override: 5000,
        cost_price: 3000,
        profit_margin: 66.67,
        is_on_sale: false,
        sale_price: null,
        stock_quantity: 10,
        track_inventory_override: null,
        service_duration_minutes: null,
        service_pricing_type: null,
        buffer_minutes: null,
        preparation_time_minutes: null,
        attributes: { presentacion: '1L' },
      },
      product: {
        id: 101,
        name: 'Coca Cola',
        sku: 'COCA',
        state: 'active',
        product_type: 'physical',
        track_inventory: true,
      },
      siblings: [{ id: 1, name: 'Pet 600ml', sku: 'COCA-600' }],
      hasActiveReservations: false,
      onHandUnits: 10,
    };

    function editDeps() {
      const deps = baseDeps();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue(
        WRITE_TARGET,
      );
      deps.productsService.updateVariant.mockResolvedValue({
        id: 2,
        sku: 'COCA-1L',
      });
      return deps;
    }

    it('(b) happy: snapshot exacto + delega en productsService.updateVariant', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_variant', {
        product_variant_id: 2,
        price_override: 5500,
      });

      expect(
        deps.productsService.findVariantWriteTargetForAgent,
      ).toHaveBeenCalledWith(2);
      expect(deps.productsService.updateVariant).toHaveBeenCalledWith(2, {
        price_override: 5500,
      });
      expect(answer).toEqual({
        summary: 'Coca Cola (COCA) — Pet 1L: 1 campo(s) actualizado(s).',
        data: {
          product_id: 101,
          product_variant_id: 2,
          updated_fields: ['price_override'],
        },
      });
    });

    it('(e) preview ok nombra producto + variante con from→to', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, 'update_variant', {
        product_variant_id: 2,
        price_override: 5500,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'Coca Cola (COCA) — Pet 1L',
        changes: [
          {
            field: 'price_override',
            label: 'Precio propio',
            from: 5000,
            to: 5500,
          },
        ],
        domain: 'products',
      });
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'update_variant',
        { product_variant_id: 2, price_override: 5500 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: las variantes se editan siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findVariantWriteTargetForAgent,
      ).not.toHaveBeenCalled();
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(a) sad: sin cambios → error sin escribir', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(
        tools,
        'update_variant',
        { product_variant_id: 2 },
      );

      expect(answer).toEqual({
        error:
          'No hay cambios: indica al menos un campo a editar (sku, name, price_override, sale_price, stock_quantity…).',
      });
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(c) variante inexistente → {error, next_step} hacia get_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue(
        null,
      );

      const answer = await run(tools, 'update_variant', {
        product_variant_id: 999,
        price_override: 5500,
      });

      expect(answer).toEqual({
        error: 'No existe una variante con id 999 en esta tienda.',
        next_step:
          'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      });
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(c) SKU hermano duplicado → {error} sin escribir', async () => {
      const deps = editDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_variant', {
        product_variant_id: 2,
        sku: 'COCA-600',
      });

      expect(answer).toEqual({
        error: 'El SKU "COCA-600" ya lo usa otra variante de "Coca Cola".',
        next_step: 'Elige un SKU distinto para esta variante.',
      });
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(c) reservas activas → {error} sin escribir', async () => {
      const deps = editDeps();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue({
        ...WRITE_TARGET,
        hasActiveReservations: true,
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_variant', {
        product_variant_id: 2,
        price_override: 5500,
      });

      expect(answer.error).toContain('tiene reservas de stock activas');
      expect(deps.productsService.updateVariant).not.toHaveBeenCalled();
    });

    it('(c) el service lanza INV_STOCK_001 → {error} con código, nunca throw', async () => {
      const deps = editDeps();
      deps.productsService.updateVariant.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.INV_STOCK_001,
          'Esta variante tiene existencias en varias ubicaciones. Ajusta el stock desde Ajustes de Stock o Transferencias, no desde el editor del producto.',
        ),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'update_variant', {
        product_variant_id: 2,
        stock_quantity: 5,
      });

      expect(answer.error).toContain('INV_STOCK_001');
      expect(answer.error).toContain('varias ubicaciones');
    });
  });

  // ─── delete_variant (O-11) ────────────────────────────────────────────
  describe('delete_variant', () => {
    const EMPTY_TARGET = {
      variant: {
        id: 2,
        product_id: 101,
        name: 'Pet 1L',
        sku: 'COCA-1L',
        stock_quantity: 0,
      },
      product: {
        id: 101,
        name: 'Coca Cola',
        sku: 'COCA',
        state: 'active',
        product_type: 'physical',
        track_inventory: true,
      },
      siblings: [{ id: 1, name: 'Pet 600ml', sku: 'COCA-600' }],
      hasActiveReservations: false,
      onHandUnits: 0,
    };

    function removeDeps() {
      const deps = baseDeps();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue(
        EMPTY_TARGET,
      );
      deps.productsService.removeVariant.mockResolvedValue({
        id: 2,
        sku: 'COCA-1L',
      });
      return deps;
    }

    it('(b) happy: snapshot exacto + delega en productsService.removeVariant', async () => {
      const deps = removeDeps();
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'delete_variant', {
        product_variant_id: 2,
      });

      expect(
        deps.productsService.findVariantWriteTargetForAgent,
      ).toHaveBeenCalledWith(2);
      expect(deps.productsService.removeVariant).toHaveBeenCalledWith(2);
      expect(answer).toEqual({
        summary: 'Variante "Coca Cola (COCA) — Pet 1L" eliminada.',
        data: { product_id: 101, product_variant_id: 2, sku: 'COCA-1L' },
      });
    });

    it('(e) preview warning: irreversible, nombra al sujeto humano', async () => {
      const deps = removeDeps();
      const { tools } = buildTools(deps);

      const result = await preview(tools, 'delete_variant', {
        product_variant_id: 2,
      });

      expect(result).toEqual({
        status: 'warning',
        target: 'Coca Cola (COCA) — Pet 1L',
        changes: [
          {
            field: 'deleted',
            label: 'Variante a eliminar',
            from: 'Coca Cola (COCA) — Pet 1L (SKU COCA-1L)',
            to: '(eliminada)',
          },
        ],
        message:
          'Esta acción no se puede deshacer: el histórico (pedidos, facturas, movimientos) se reasigna al producto base y la variante desaparece.',
        domain: 'products',
      });
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'delete_variant',
        { product_variant_id: 2 },
        {},
      );

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: las variantes se eliminan siempre dentro de una tienda.',
      });
      expect(
        deps.productsService.findVariantWriteTargetForAgent,
      ).not.toHaveBeenCalled();
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();
    });

    it('(c) variante inexistente → {error, next_step} hacia get_product', async () => {
      const { deps, tools } = buildTools();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue(
        null,
      );

      const answer = await run(tools, 'delete_variant', {
        product_variant_id: 999,
      });

      expect(answer).toEqual({
        error: 'No existe una variante con id 999 en esta tienda.',
        next_step:
          'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      });
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();
    });

    it('(c) bloqueo PROD_VARIANT_HAS_STOCK_001: con stock no hay token', async () => {
      const deps = removeDeps();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue({
        ...EMPTY_TARGET,
        onHandUnits: 40,
      });
      const { tools } = buildTools(deps);

      const blocked = await preview(tools, 'delete_variant', {
        product_variant_id: 2,
      });

      expect(blocked.status).toBe('error');
      expect(blocked.target).toBe('Coca Cola (COCA) — Pet 1L');
      expect(blocked.changes).toEqual([]);
      expect(blocked.message).toContain('40 unidad(es) en existencia');
      expect(blocked.message).toContain('PROD_VARIANT_HAS_STOCK_001');
      expect(blocked.message).toContain('adjust_stock');
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();

      // El handler re-verifica la misma guarda: tampoco escribe.
      const answer = await run(tools, 'delete_variant', {
        product_variant_id: 2,
      });
      expect(answer.error).toContain('40 unidad(es) en existencia');
      expect(answer.next_step).toContain('adjust_stock');
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();
    });

    it('(c) reservas activas → {error} sin escribir', async () => {
      const deps = removeDeps();
      deps.productsService.findVariantWriteTargetForAgent.mockResolvedValue({
        ...EMPTY_TARGET,
        hasActiveReservations: true,
      });
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'delete_variant', {
        product_variant_id: 2,
      });

      expect(answer.error).toContain('tiene reservas de stock activas');
      expect(deps.productsService.removeVariant).not.toHaveBeenCalled();
    });

    it('(c) carrera: el service lanza PROD_VARIANT_HAS_STOCK_001 → {error} con código y next_step', async () => {
      const deps = removeDeps();
      deps.productsService.removeVariant.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.PROD_VARIANT_HAS_STOCK_001,
          'Operación bloqueada: la variante #2 tiene 3 unidad(es) en existencia. Ajusta el stock a 0 antes de eliminarla.',
        ),
      );
      const { tools } = buildTools(deps);

      const answer = await run(tools, 'delete_variant', {
        product_variant_id: 2,
      });

      expect(answer.error).toContain('PROD_VARIANT_HAS_STOCK_001');
      expect(answer.error).toContain('3 unidad(es) en existencia');
      expect(answer.next_step).toContain('adjust_stock');
    });
  });
});
