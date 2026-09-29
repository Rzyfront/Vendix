import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  createMenuTools,
  createProductionTools,
  createRecipeTools,
} from './menus.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 13 — contrato K-12 `manage_recipe`, K-13 `manage_menu`,
 * K-14 `analyze_menu_engineering`, K-15 `manage_production_order`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca las deps;
 * (b) snapshot JSON exacto de la salida happy; (c) forma
 * `{error, next_step}` en español; (d) permiso declarado por tool;
 * (e) circuito de escritura: los writes llevan `requiresConfirmation` +
 * `preview` con sujeto humano y re-verificación en el handler.
 *
 * Casos fijados por el plan: rechazo de ciclo de receta
 * (RECIPE_CYCLE_DETECTED), rechazo de quantity fraccionaria (unidades
 * enteras mínimas, sin Decimal) y `complete()` con movimientos
 * consumption/production + asiento 1435 (vía el servicio dueño).
 */
describe('menus.tools · K-12 recipe / K-13 menu / K-14 BCG / K-15 production', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  const RECIPE = {
    id: 21,
    product_id: 301,
    product: { id: 301, name: 'Bandeja paisa' },
    product_variant: null,
    yield_quantity: '2',
    yield_unit: 'porción',
    waste_percent: '0',
    is_active: true,
    recipe_items: [
      {
        id: 91,
        component_product_id: 701,
        quantity: '400',
        component_product: { name: 'Fríjol' },
      },
    ],
  };

  function recipeTools(overrides: Record<string, any> = {}) {
    return createRecipeTools({
      recipesService: {
        findOne: jest.fn().mockResolvedValue(structuredClone(RECIPE)),
        findByProduct: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        softDelete: jest.fn(),
        restore: jest.fn(),
        replaceItems: jest.fn(),
        addItem: jest.fn(),
        updateItem: jest.fn(),
        removeItem: jest.fn(),
        ...overrides,
      } as any,
    });
  }

  function menuTools(overrides: {
    menusService?: Record<string, any>;
    menuSectionsService?: Record<string, any>;
    menuAvailabilityService?: Record<string, any>;
    menuAvailabilityChecker?: Record<string, any>;
    menuEngineeringService?: Record<string, any>;
  } = {}) {
    return createMenuTools({
      menusService: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 5, name: 'Carta principal' }),
        create: jest.fn(),
        update: jest.fn(),
        softDelete: jest.fn(),
        ...overrides.menusService,
      } as any,
      menuSectionsService: {
        createSection: jest.fn(),
        updateSection: jest.fn(),
        deleteSection: jest.fn(),
        addItem: jest.fn(),
        removeItem: jest.fn(),
        ...overrides.menuSectionsService,
      } as any,
      menuAvailabilityService: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        ...overrides.menuAvailabilityService,
      } as any,
      menuAvailabilityChecker: {
        getStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
        ...overrides.menuAvailabilityChecker,
      } as any,
      menuEngineeringService: {
        report: jest.fn(),
        ...overrides.menuEngineeringService,
      } as any,
    });
  }

  function productionTools(overrides: Record<string, any> = {}) {
    return createProductionTools({
      productionOrdersService: {
        findOne: jest.fn().mockResolvedValue({
          id: 31,
          status: 'draft',
          product_id: 401,
          product: { name: 'Salsa madre' },
          planned_qty: '10',
        }),
        create: jest.fn(),
        update: jest.fn(),
        start: jest.fn(),
        complete: jest.fn(),
        cancel: jest.fn(),
        ...overrides,
      } as any,
    });
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => JSON.parse(await getTool(tools, name).handler!(args, context as any));

  // ─── (d)+(e) Registro ─────────────────────────────────────────────
  describe('registro', () => {
    it('expone las 4 tools con version 1 y dominio menus', () => {
      expect(recipeTools().map((tool) => tool.name)).toEqual([
        'manage_recipe',
      ]);
      expect(menuTools().map((tool) => tool.name)).toEqual([
        'manage_menu',
        'analyze_menu_engineering',
      ]);
      expect(productionTools().map((tool) => tool.name)).toEqual([
        'manage_production_order',
      ]);
      for (const tools of [recipeTools(), menuTools(), productionTools()]) {
        for (const tool of tools) {
          expect(tool.version).toBe('1');
          expect(tool.domain).toBe('menus');
          expect(tool.description.length).toBeGreaterThan(20);
        }
      }
    });

    it('declara los permisos exactos de cada endpoint dueño', () => {
      expect(
        getTool(recipeTools(), 'manage_recipe').requiredPermissions,
      ).toEqual([
        'store:recipes:create',
        'store:recipes:update',
        'store:recipes:delete',
      ]);
      expect(
        getTool(menuTools(), 'manage_menu').requiredPermissions,
      ).toEqual([
        'store:menus:create',
        'store:menus:update',
        'store:menus:delete',
      ]);
      expect(
        getTool(menuTools(), 'analyze_menu_engineering').requiredPermissions,
      ).toEqual(['store:menu_engineering:read']);
      expect(
        getTool(productionTools(), 'manage_production_order')
          .requiredPermissions,
      ).toEqual([
        'store:production_orders:create',
        'store:production_orders:update',
      ]);
    });

    it('K-14 es readOnly; K-12/K-13/K-15 son writes con circuito completo', () => {
      const read = getTool(menuTools(), 'analyze_menu_engineering');
      expect(read.readOnly).toBe(true);
      expect(read.requiresConfirmation).toBeUndefined();
      expect(read.preview).toBeUndefined();
      for (const [tools, name] of [
        [recipeTools(), 'manage_recipe'],
        [menuTools(), 'manage_menu'],
        [productionTools(), 'manage_production_order'],
      ] as const) {
        const tool = getTool(tools, name);
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
      }
    });

    it('cada write cita su read habilitante', () => {
      expect(getTool(recipeTools(), 'manage_recipe').description).toMatch(
        /get_product/,
      );
      expect(getTool(menuTools(), 'manage_menu').description).toMatch(
        /get_product/,
      );
      expect(
        getTool(productionTools(), 'manage_production_order').description,
      ).toMatch(/get_product/);
    });
  });

  // ─── K-12 manage_recipe ───────────────────────────────────────────
  describe('manage_recipe', () => {
    it('(b) happy set-items: preview nombra el plato y delega (snapshot)', async () => {
      const replaceItems = jest.fn().mockResolvedValue({});
      const findOne = jest
        .fn()
        .mockResolvedValue(structuredClone(RECIPE));
      const tools = recipeTools({ findOne, replaceItems });
      const tool = getTool(tools, 'manage_recipe');
      const args = {
        action: 'set-items',
        recipe_id: 21,
        items: [
          { component_product_id: 701, quantity: 400 },
          { component_product_id: 702, quantity: 300, waste_percent: 5 },
        ],
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('warning');
      expect(preview.target).toContain('Bandeja paisa');

      const answer = await run(tools, 'manage_recipe', args);
      expect(replaceItems).toHaveBeenCalledWith(
        21,
        expect.arrayContaining([
          expect.objectContaining({
            component_product_id: 701,
            quantity: 400,
          }),
        ]),
      );
      expect(answer).toEqual({
        resumen:
          'Bandeja paisa [receta #21]: 2 insumo(s) en la receta (reemplazo total).',
        recipe_id: 21,
      });
    });

    it('(a) sad: quantity fraccionaria se rechaza (unidades enteras mínimas)', async () => {
      const replaceItems = jest.fn();
      const tools = recipeTools({ replaceItems });
      const tool = getTool(tools, 'manage_recipe');
      const args = {
        action: 'set-items',
        recipe_id: 21,
        items: [{ component_product_id: 701, quantity: 0.5 }],
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/fraccionaria/);
      expect(preview.message).toMatch(/gramos/);

      const answer = await run(tools, 'manage_recipe', args);
      expect(answer.error).toMatch(/fraccionaria/);
      expect(answer.next_step).toMatch(/unidad mínima entera/);
      expect(replaceItems).not.toHaveBeenCalled();
    });

    it('(c) sad: ciclo de sub-recetas → RECIPE_CYCLE_DETECTED con remedio', async () => {
      const tools = recipeTools({
        replaceItems: jest
          .fn()
          .mockRejectedValue(
            new VendixHttpException(ErrorCodes.RECIPE_CYCLE_DETECTED),
          ),
      });

      const answer = await run(tools, 'manage_recipe', {
        action: 'set-items',
        recipe_id: 21,
        items: [{ component_product_id: 301, quantity: 1 }],
      });

      expect(answer.error).toContain('RECIPE_CYCLE_DETECTED');
      expect(answer.next_step).toContain('transitivamente');
    });

    it('(e) add-item re-lee la receta antes de mutar', async () => {
      const findOne = jest
        .fn()
        .mockResolvedValue(structuredClone(RECIPE));
      const addItem = jest.fn().mockResolvedValue({ id: 92 });
      const tools = recipeTools({ findOne, addItem });

      const answer = await run(tools, 'manage_recipe', {
        action: 'add-item',
        recipe_id: 21,
        component_product_id: 703,
        quantity: 50,
      });

      expect(findOne).toHaveBeenCalledWith(21);
      expect(addItem).toHaveBeenCalledWith(
        21,
        expect.objectContaining({
          component_product_id: 703,
          quantity: 50,
        }),
      );
      expect(answer.resumen).toContain('Bandeja paisa');
    });
  });

  // ─── K-13 manage_menu ─────────────────────────────────────────────
  describe('manage_menu', () => {
    it('(b) happy add-window: preview en hora de tienda y delega (snapshot)', async () => {
      const create = jest.fn().mockResolvedValue({ id: 12 });
      const tools = menuTools({
        menuAvailabilityService: { create },
      });
      const tool = getTool(tools, 'manage_menu');
      const args = {
        action: 'add-window',
        menu_id: 5,
        day_of_week: 5,
        start_time: '12:00',
        end_time: '22:00',
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('viernes 12:00–22:00');
      expect(preview.target).toContain('America/Bogota');

      const answer = await run(tools, 'manage_menu', args);
      expect(create).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          day_of_week: 5,
          start_time: '12:00',
          end_time: '22:00',
        }),
      );
      expect(answer).toEqual({
        resumen:
          'Carta "Carta principal": ventana viernes 12:00–22:00 creada (#12, hora America/Bogota).',
        menu_id: 5,
        window_id: 12,
      });
    });

    it('(a) sad: HH:mm inválido lo rechaza el DTO real sin tocar el servicio', async () => {
      const create = jest.fn();
      const tools = menuTools({
        menuAvailabilityService: { create },
      });

      const answer = await run(tools, 'manage_menu', {
        action: 'add-window',
        menu_id: 5,
        day_of_week: 5,
        start_time: '25:00',
        end_time: '22:00',
      });

      expect(answer.error).toMatch(/validación/);
      expect(create).not.toHaveBeenCalled();
    });

    it('(b) happy create-section + add-item delegan con DTOs reales', async () => {
      const createSection = jest
        .fn()
        .mockResolvedValue({ id: 8, name: 'Fuertes' });
      const addItem = jest.fn().mockResolvedValue({ id: 44 });
      const tools = menuTools({
        menuSectionsService: { createSection, addItem },
      });

      const section = await run(tools, 'manage_menu', {
        action: 'create-section',
        menu_id: 5,
        name: 'Fuertes',
      });
      expect(createSection).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ name: 'Fuertes' }),
      );
      expect(section.section_id).toBe(8);

      const item = await run(tools, 'manage_menu', {
        action: 'add-item',
        menu_id: 5,
        section_id: 8,
        product_id: 301,
      });
      expect(addItem).toHaveBeenCalledWith(
        5,
        8,
        expect.objectContaining({ product_id: 301 }),
      );
      expect(item.resumen).toContain('producto #301');
    });
  });

  // ─── K-14 analyze_menu_engineering ────────────────────────────────
  describe('analyze_menu_engineering', () => {
    const REPORT = {
      from: '2026-01-01',
      to: '2026-01-31',
      totals: { units_sold: 100, revenue: 3000000, profit: 1200000 },
      thresholds: { popularity_median: 10, margin_median: 35 },
      counts: { estrella: 1, caballo: 1, puzzle: 0, perro: 0 },
      groups: {
        estrella: [
          {
            product_id: 301,
            name: 'Bandeja paisa',
            units_sold: 60,
            revenue: 1920000,
            profit: 900000,
            margin_percent: 46.9,
          },
        ],
        caballo: [
          {
            product_id: 302,
            name: 'Ajiaco',
            units_sold: 40,
            revenue: 1080000,
            profit: 300000,
            margin_percent: 27.8,
          },
        ],
        puzzle: [],
        perro: [],
      },
    };

    it('(b) happy: matriz BCG compacta por cuadrante (snapshot)', async () => {
      const report = jest.fn().mockResolvedValue(structuredClone(REPORT));
      const tools = menuTools({ menuEngineeringService: { report } });

      const answer = await run(tools, 'analyze_menu_engineering', {
        from: '2026-01-01',
        to: '2026-01-31',
      });

      expect(report).toHaveBeenCalledWith({
        from: '2026-01-01',
        to: '2026-01-31',
      });
      expect(answer.conteo).toEqual({
        estrella: 1,
        caballo: 1,
        puzzle: 0,
        perro: 0,
      });
      expect(answer.cuadrantes.estrella).toEqual([
        {
          product_id: 301,
          name: 'Bandeja paisa',
          units_sold: 60,
          revenue: 1920000,
          profit: 900000,
          margin_percent: 46.9,
        },
      ]);
      expect(answer.next_step).toMatch(/manage_recipe/);
    });

    it('(c) sad: fallo del servicio → {error, next_step}', async () => {
      const tools = menuTools({
        menuEngineeringService: {
          report: jest.fn().mockRejectedValue(new Error('timeout')),
        },
      });

      const answer = await run(tools, 'analyze_menu_engineering', {});

      expect(answer.error).toMatch(/No pude analizar la carta/);
      expect(answer.next_step).toMatch(/YYYY-MM-DD/);
    });
  });

  // ─── K-15 manage_production_order ────────────────────────────────
  describe('manage_production_order', () => {
    it('(b) happy complete: preview irreversible y handler delega con DTO real (snapshot)', async () => {
      const complete = jest
        .fn()
        .mockResolvedValue({ id: 31, status: 'completed', produced_qty: '9' });
      const findOne = jest.fn().mockResolvedValue({
        id: 31,
        status: 'in_progress',
        product_id: 401,
        product: { name: 'Salsa madre' },
        planned_qty: '10',
      });
      const tools = productionTools({ findOne, complete });
      const tool = getTool(tools, 'manage_production_order');
      const args = { action: 'complete', order_id: 31, produced_qty: 9 };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('warning');
      expect(preview.target).toContain('Salsa madre');
      expect(preview.message).toMatch(/1435/);

      const answer = await run(tools, 'manage_production_order', args);
      // El servicio dueño corre consumo+producción en UNA transacción y
      // emite production.completed post-commit: la tool solo valida el
      // borde y delega (movimientos consumption/production + asiento
      // 1435/1435 los fija la spec del servicio).
      expect(complete).toHaveBeenCalledWith(
        31,
        expect.objectContaining({ produced_qty: 9 }),
      );
      expect(answer).toEqual({
        resumen:
          'Orden #31 (Salsa madre): completada con 9 producidos (insumos consumidos + alta de terminado, asiento 1435/1435).',
        order_id: 31,
        produced_qty: '9',
      });
    });

    it('(a) sad: complete sin produced_qty no toca el servicio', async () => {
      const complete = jest.fn();
      const tools = productionTools({ complete });
      const tool = getTool(tools, 'manage_production_order');

      const preview = await tool.preview!(
        { action: 'complete', order_id: 31 },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(complete).not.toHaveBeenCalled();

      const answer = await run(tools, 'manage_production_order', {
        action: 'complete',
        order_id: 31,
      });
      expect(answer.error).toMatch(/produced_qty/);
      expect(complete).not.toHaveBeenCalled();
    });

    it('(e) re-verificación: orden completada tras el preview → no duplica', async () => {
      const complete = jest.fn();
      const tools = productionTools({
        findOne: jest.fn().mockResolvedValue({
          id: 31,
          status: 'completed',
          product: { name: 'Salsa madre' },
        }),
        complete,
      });

      const answer = await run(tools, 'manage_production_order', {
        action: 'complete',
        order_id: 31,
        produced_qty: 9,
      });

      expect(answer.error).toMatch(/ya está completed/);
      expect(complete).not.toHaveBeenCalled();
    });

    it('(b) happy start/cancel respetan la máquina de estados', async () => {
      const start = jest.fn().mockResolvedValue({ id: 31 });
      const cancel = jest.fn().mockResolvedValue({ id: 31 });
      const draft = jest.fn().mockResolvedValue({
        id: 31,
        status: 'draft',
        product: { name: 'Salsa madre' },
      });
      const tools = productionTools({
        findOne: draft,
        start,
        cancel,
      });

      const started = await run(tools, 'manage_production_order', {
        action: 'start',
        order_id: 31,
      });
      expect(start).toHaveBeenCalledWith(31);
      expect(started.resumen).toContain('iniciada');

      const cancelled = await run(tools, 'manage_production_order', {
        action: 'cancel',
        order_id: 31,
      });
      expect(cancel).toHaveBeenCalledWith(31);
      expect(cancelled.resumen).toContain('cancelada');
    });
  });
});
