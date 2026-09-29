import { ErrorCodes, VendixHttpException } from '@common/errors';
import { createKitchenTools, KitchenToolDeps } from './kitchen.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 track A — contrato K-1 `preview_kitchen_fire`, K-2
 * `fire_kitchen_order`, K-4 `list_kitchen_tickets`, K-5
 * `transition_kitchen_ticket`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca las deps;
 * (b) snapshot JSON exacto de la salida happy; (c) forma
 * `{error, next_step}` en español; (d) permiso declarado por tool;
 * (e) circuito de escritura: K-1/K-4 son `readOnly`, K-2/K-5 exigen
 * `requiresConfirmation` + `preview` con sujeto humano y re-verifican en
 * el handler (el preview es proyección, no transacción).
 */
describe('kitchen.tools · K-1 preview / K-2 fire / K-4 tickets / K-5 transition', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  const PREVIEW_FIRE = {
    order_id: 501,
    items: [
      {
        order_item_id: 9001,
        product_id: 301,
        product_name: 'Bandeja paisa',
        quantity: 2,
        notes: null,
        has_active_recipe: true,
        components: [
          {
            component_product_id: 701,
            name: 'Fríjol',
            sku: 'INS-701',
            stock_unit: 'gram',
            quantity: 400,
          },
          {
            component_product_id: 702,
            name: 'Arroz',
            sku: 'INS-702',
            stock_unit: 'gram',
            quantity: 300,
          },
        ],
      },
      {
        order_item_id: 9002,
        product_id: 302,
        product_name: 'Ajiaco',
        quantity: 1,
        notes: 'sin crema',
        has_active_recipe: true,
        components: [
          {
            component_product_id: 702,
            name: 'Arroz',
            sku: 'INS-702',
            stock_unit: 'gram',
            quantity: 150,
          },
        ],
      },
    ],
    skipped_item_ids: [9003],
  };

  function buildTools(
    overrides: {
      kitchenFireService?: Record<string, any>;
      stockValidator?: Record<string, any>;
    } = {},
  ) {
    const deps = {
      kitchenFireService: {
        previewFire: jest.fn().mockResolvedValue(structuredClone(PREVIEW_FIRE)),
        fireOrderItems: jest.fn(),
        resendOrderItems: jest.fn(),
        findTickets: jest.fn(),
        findTicketById: jest.fn(),
        getTicketVerification: jest.fn(),
        startPreparation: jest.fn(),
        markReady: jest.fn(),
        markDelivered: jest.fn(),
        revertTicket: jest.fn(),
        ...overrides.kitchenFireService,
      } as any,
      stockValidator: {
        resolveInventoryPolicy: jest
          .fn()
          .mockResolvedValue({ allow_ingredient_overuse: true }),
        assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
        ...overrides.stockValidator,
      } as any,
    } satisfies KitchenToolDeps;
    return { deps, tools: createKitchenTools(deps) };
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
    it('expone exactamente las 5 tools del dominio kitchen (P0 + K-3)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'preview_kitchen_fire',
        'fire_kitchen_order',
        'resend_kitchen_items',
        'list_kitchen_tickets',
        'transition_kitchen_ticket',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('kitchen');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('declara el permiso exacto de cada endpoint dueño', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(
        byName.get('preview_kitchen_fire')!.requiredPermissions,
      ).toEqual(['store:kitchen_fire:read']);
      expect(byName.get('fire_kitchen_order')!.requiredPermissions).toEqual([
        'store:kitchen_fire:create',
      ]);
      expect(byName.get('resend_kitchen_items')!.requiredPermissions).toEqual([
        'store:kitchen_fire:resend',
      ]);
      expect(byName.get('list_kitchen_tickets')!.requiredPermissions).toEqual([
        'store:kitchen_fire:read',
      ]);
      expect(
        byName.get('transition_kitchen_ticket')!.requiredPermissions,
      ).toEqual(['store:kitchen_fire:update']);
    });

    it('K-1/K-4 son readOnly; K-2/K-3/K-5 son writes con circuito completo', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of ['preview_kitchen_fire', 'list_kitchen_tickets']) {
        const tool = byName.get(name)!;
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
      }
      for (const name of [
        'fire_kitchen_order',
        'resend_kitchen_items',
        'transition_kitchen_ticket',
      ]) {
        const tool = byName.get(name)!;
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
      }
    });

    it('declara requeridos y enums del JSON Schema', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(
        byName.get('preview_kitchen_fire')!.parameters.required,
      ).toEqual(['order_id', 'order_item_ids']);
      expect(byName.get('fire_kitchen_order')!.parameters.required).toEqual([
        'order_id',
        'order_item_ids',
        'preview_hash',
      ]);
      expect(
        byName.get('transition_kitchen_ticket')!.parameters.required,
      ).toEqual(['ticket_id', 'action', 'ticket_status_seen']);
      expect(
        byName.get('transition_kitchen_ticket')!.parameters.properties.action
          .enum,
      ).toEqual(['start', 'ready', 'delivered', 'revert']);
    });
  });

  // ─── K-1 preview_kitchen_fire ─────────────────────────────────────
  describe('preview_kitchen_fire', () => {
    it('(b) happy: agrega el BOM por insumo compartido y ata preview_hash', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'preview_kitchen_fire', {
        order_id: 501,
        order_item_ids: [9001, 9002],
      });

      // El Arroz (702) aparece en dos platos: se valida una vez, sumado.
      expect(answer.demands_aggregated).toEqual([
        {
          product_id: 701,
          quantity: 400,
          product_name: 'Fríjol',
          used_by: 'Bandeja paisa',
        },
        {
          product_id: 702,
          quantity: 450,
          product_name: 'Arroz',
          used_by: 'Bandeja paisa; Ajiaco',
        },
      ]);
      expect(
        deps.stockValidator.assertIngredientsAvailable,
      ).toHaveBeenCalledWith(answer.demands_aggregated, {
        allowIngredientOveruse: true,
      });
      expect(answer).toMatchObject({
        order_id: 501,
        skipped_item_ids: [9003],
        ingredient_policy: { allow_ingredient_overuse: true },
        shortfalls: [],
        blocked: false,
        recipe_less: [],
      });
      expect(answer.preview_hash).toMatch(/^[0-9a-f]{32}$/);
      expect(answer.next_step).toContain('fire_kitchen_order');
    });

    it('política null resuelve a sobre-uso permitido (default ?? true)', async () => {
      const { deps, tools } = buildTools({
        stockValidator: {
          resolveInventoryPolicy: jest
            .fn()
            .mockResolvedValue({ allow_ingredient_overuse: null }),
          assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
        },
      });

      const answer = await run(tools, 'preview_kitchen_fire', {
        order_id: 501,
        order_item_ids: [9001, 9002],
      });

      expect(answer.ingredient_policy).toEqual({
        allow_ingredient_overuse: true,
      });
      expect(
        deps.stockValidator.assertIngredientsAvailable,
      ).toHaveBeenCalledWith(expect.anything(), {
        allowIngredientOveruse: true,
      });
    });

    it('con switch estricto el faltante bloquea en vez de advertir', async () => {
      const shortfall = {
        product_id: 701,
        product_name: 'Fríjol',
        kind: 'ingredient',
        requested: 400,
        available: 50,
        used_by: 'Bandeja paisa',
      };
      const { tools } = buildTools({
        stockValidator: {
          resolveInventoryPolicy: jest
            .fn()
            .mockResolvedValue({ allow_ingredient_overuse: false }),
          assertIngredientsAvailable: jest
            .fn()
            .mockRejectedValue(
              new VendixHttpException(
                ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
                'insuficiente',
                { items: [shortfall] },
              ),
            ),
        },
      });

      const answer = await run(tools, 'preview_kitchen_fire', {
        order_id: 501,
        order_item_ids: [9001, 9002],
      });

      expect(answer.shortfalls).toEqual([shortfall]);
      expect(answer.blocked).toBe(true);
    });

    it('(a) sad: sin tienda → error y cero llamadas al servicio', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'preview_kitchen_fire',
        { order_id: 501, order_item_ids: [9001] },
        {},
      );

      expect(answer).toEqual({
        error: expect.stringContaining('Sin tienda en contexto'),
      });
      expect(deps.kitchenFireService.previewFire).not.toHaveBeenCalled();
      expect(
        deps.stockValidator.assertIngredientsAvailable,
      ).not.toHaveBeenCalled();
    });

    it('(c) nada enviable → error guiado', async () => {
      const { tools } = buildTools({
        kitchenFireService: {
          previewFire: jest.fn().mockResolvedValue({
            order_id: 501,
            items: [],
            skipped_item_ids: [9001],
          }),
        },
      });

      const answer = await run(tools, 'preview_kitchen_fire', {
        order_id: 501,
        order_item_ids: [9001],
      });

      expect(answer.error).toContain('Ninguno de esos renglones');
      expect(answer.next_step).toContain('pendientes de cocina');
    });
  });

  // ─── K-2 fire_kitchen_order ───────────────────────────────────────
  describe('fire_kitchen_order', () => {
    async function previewHashFor(
      tools: RegisteredTool[],
      args: Record<string, any> = {
        order_id: 501,
        order_item_ids: [9001, 9002],
      },
    ): Promise<string> {
      const k1 = await run(tools, 'preview_kitchen_fire', args);
      return k1.preview_hash as string;
    }

    it('(e) preview: sujeto humano por plato y estado ok', async () => {
      const { tools } = buildTools();
      const previewHash = await previewHashFor(tools);
      const tool = getTool(tools, 'fire_kitchen_order');

      const preview = await tool.preview!(
        { order_id: 501, order_item_ids: [9001, 9002], preview_hash: previewHash },
        CONTEXT as any,
      );

      expect(preview.status).toBe('ok');
      // Sujeto humano ("Bandeja paisa"), no solo "#9001".
      expect(preview.target).toContain('Bandeja paisa x2');
      expect(preview.target).toContain('Ajiaco x1');
      expect(preview.changes).toHaveLength(2);
      expect(preview.changes[0]).toMatchObject({
        field: 'item:9001',
        label: 'Bandeja paisa',
        from: 'en borrador',
      });
      expect(preview.domain).toBe('kitchen');
    });

    it('(b) happy: handler dispara con el hash vigente y resume', async () => {
      const { deps, tools } = buildTools({
        kitchenFireService: {
          fireOrderItems: jest.fn().mockResolvedValue({
            kitchen_ticket_id: 77,
            kitchen_ticket_ids: [77],
            order_id: 501,
            fired_item_ids: [9001, 9002],
            skipped_item_ids: [9003],
            cogs_total: 12500,
            consumed_line_count: 3,
          }),
        },
      });
      const previewHash = await previewHashFor(tools);

      const answer = await run(tools, 'fire_kitchen_order', {
        order_id: 501,
        order_item_ids: [9001, 9002],
        preview_hash: previewHash,
      });

      expect(answer).toEqual({
        resumen:
          'Enviados a cocina (Bandeja paisa x2; Ajiaco x1) — ticket #77',
        kitchen_ticket_id: 77,
        kitchen_ticket_ids: [77],
        fired_item_ids: [9001, 9002],
        skipped_item_ids: [9003],
        cogs_total: 12500,
      });
      expect(deps.kitchenFireService.fireOrderItems).toHaveBeenCalledTimes(1);
      expect(deps.kitchenFireService.fireOrderItems).toHaveBeenCalledWith(
        expect.objectContaining({ order_id: 501 }),
      );
    });

    it('(c) recipe-less: el preview lo marca pero no lo bloquea', async () => {
      const recipeLess = structuredClone(PREVIEW_FIRE);
      recipeLess.items[1].has_active_recipe = false;
      recipeLess.items[1].components = [];
      const { tools } = buildTools({
        kitchenFireService: {
          previewFire: jest.fn().mockResolvedValue(recipeLess),
        },
      });
      const k1 = await run(tools, 'preview_kitchen_fire', {
        order_id: 501,
        order_item_ids: [9001, 9002],
      });
      expect(k1.recipe_less).toEqual(['Ajiaco']);

      const tool = getTool(tools, 'fire_kitchen_order');
      const preview = await tool.preview!(
        {
          order_id: 501,
          order_item_ids: [9001, 9002],
          preview_hash: k1.preview_hash,
        },
        CONTEXT as any,
      );

      expect(preview.status).toBe('warning');
      expect(preview.changes[1].to).toContain('SIN receta');
    });

    it('(c) fire sin preview → {error, next_step} en preview y handler', async () => {
      const { deps, tools } = buildTools();
      const tool = getTool(tools, 'fire_kitchen_order');

      const preview = await tool.preview!(
        { order_id: 501, order_item_ids: [9001, 9002] },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('preview_kitchen_fire');

      const answer = await run(tools, 'fire_kitchen_order', {
        order_id: 501,
        order_item_ids: [9001, 9002],
      });
      expect(answer).toEqual({
        error: expect.stringContaining('exige preview_kitchen_fire'),
        next_step: expect.stringContaining('preview_hash'),
      });
      expect(deps.kitchenFireService.fireOrderItems).not.toHaveBeenCalled();
    });

    it('(e) re-verificación: hash viejo tras moverse el stock → no dispara', async () => {
      const { deps, tools } = buildTools();
      const staleHash = await previewHashFor(tools);
      // El mundo se movió: ahora falta un insumo que antes alcanzaba. El
      // hash vigente cambia, así que el hash de K-1 ya no coincide.
      deps.stockValidator.assertIngredientsAvailable.mockResolvedValue([
        {
          product_id: 701,
          kind: 'ingredient',
          requested: 400,
          available: 0,
        },
      ]);

      const answer = await run(tools, 'fire_kitchen_order', {
        order_id: 501,
        order_item_ids: [9001, 9002],
        preview_hash: staleHash,
      });

      expect(answer.error).toContain('cambió desde la confirmación');
      expect(answer.next_step).toContain('preview_kitchen_fire');
      expect(deps.kitchenFireService.fireOrderItems).not.toHaveBeenCalled();
    });
  });

  // ─── K-4 list_kitchen_tickets ─────────────────────────────────────
  describe('list_kitchen_tickets', () => {
    const TICKET_ROW = {
      id: 77,
      status: 'pending',
      order_id: 501,
      order: { order_number: 'OV-501' },
      table: { id: 3, name: 'Mesa 3' },
      fired_at: '2026-09-29T12:00:00.000Z',
      items: [
        {
          id: 1,
          quantity: 2,
          status: 'pending',
          notes: null,
          product: { name: 'Bandeja paisa' },
        },
      ],
    };

    it('(b) happy: snapshot de la foto del KDS', async () => {
      const { tools } = buildTools({
        kitchenFireService: {
          findTickets: jest.fn().mockResolvedValue({
            data: [TICKET_ROW],
            total: 1,
          }),
        },
      });

      const answer = await run(tools, 'list_kitchen_tickets', {
        status: 'pending',
      });

      expect(answer).toEqual({
        tickets: [
          {
            ticket_id: 77,
            status: 'pending',
            order_id: 501,
            order_number: 'OV-501',
            table: { id: 3, name: 'Mesa 3' },
            fired_at: '2026-09-29T12:00:00.000Z',
            items: [
              {
                product_name: 'Bandeja paisa',
                quantity: 2,
                status: 'pending',
                notes: null,
              },
            ],
          },
        ],
        total: 1,
        next_step: expect.stringContaining('transition_kitchen_ticket'),
      });
    });

    it('ticket_id devuelve detalle + verificación de recetas', async () => {
      const { deps, tools } = buildTools({
        kitchenFireService: {
          findTicketById: jest.fn().mockResolvedValue(TICKET_ROW),
          getTicketVerification: jest.fn().mockResolvedValue({
            order_id: 501,
            items: [
              {
                order_item_id: 9001,
                product_name: 'Bandeja paisa',
                has_active_recipe: true,
                components: [],
              },
            ],
            skipped_item_ids: [],
          }),
        },
      });

      const answer = await run(tools, 'list_kitchen_tickets', {
        ticket_id: 77,
      });

      expect(answer.ticket).toMatchObject({
        ticket_id: 77,
        status: 'pending',
      });
      expect(answer.verification.items).toHaveLength(1);
      expect(deps.kitchenFireService.findTickets).not.toHaveBeenCalled();
    });

    it('(a) sad: status inválido → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_kitchen_tickets', {
        status: 'cocinando',
      });

      expect(answer.error).toContain('inválido');
      expect(deps.kitchenFireService.findTickets).not.toHaveBeenCalled();
    });

    it('(c) ticket inexistente → error guiado', async () => {
      const { tools } = buildTools({
        kitchenFireService: {
          findTicketById: jest
            .fn()
            .mockRejectedValue(
              new VendixHttpException(
                ErrorCodes.KITCHEN_TICKET_NOT_FOUND,
                'no existe',
              ),
            ),
        },
      });

      const answer = await run(tools, 'list_kitchen_tickets', {
        ticket_id: 999,
      });

      expect(answer.error).toContain('no existe en esta tienda');
      expect(answer.next_step).toContain('ticket_id');
    });
  });

  // ─── K-5 transition_kitchen_ticket ────────────────────────────────
  describe('transition_kitchen_ticket', () => {
    const TICKET = {
      id: 77,
      status: 'pending',
      order_id: 501,
      items: [{ id: 1, quantity: 2, product: { name: 'Bandeja paisa' } }],
    };

    function ticketTools(status = 'pending', verification: any = null) {
      return buildTools({
        kitchenFireService: {
          findTicketById: jest
            .fn()
            .mockResolvedValue({ ...TICKET, status }),
          getTicketVerification: jest.fn().mockResolvedValue(
            verification ?? {
              order_id: 501,
              items: [
                {
                  product_name: 'Bandeja paisa',
                  has_active_recipe: true,
                  components: [],
                },
              ],
              skipped_item_ids: [],
            },
          ),
          startPreparation: jest.fn().mockResolvedValue({}),
        },
      });
    }

    it('(e) preview start: sujeto humano y cambio from→to', async () => {
      const { tools } = ticketTools();
      const tool = getTool(tools, 'transition_kitchen_ticket');

      const preview = await tool.preview!(
        { ticket_id: 77, action: 'start', ticket_status_seen: 'pending' },
        CONTEXT as any,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('Ticket #77');
      expect(preview.target).toContain('Bandeja paisa');
      expect(preview.changes).toEqual([
        {
          field: 'status',
          label: 'Estado',
          from: 'pending',
          to: 'en preparación',
        },
      ]);
    });

    it('(b) happy: start re-verifica y resume', async () => {
      const { deps, tools } = ticketTools();

      const answer = await run(tools, 'transition_kitchen_ticket', {
        ticket_id: 77,
        action: 'start',
        ticket_status_seen: 'pending',
      });

      expect(answer).toEqual({
        resumen: 'Ticket #77: pending → start',
        ticket_id: 77,
        from: 'pending',
        action: 'start',
      });
      expect(deps.kitchenFireService.startPreparation).toHaveBeenCalledWith(
        77,
      );
    });

    it('(c) start sin receta → KITCHEN_TICKET_NO_RECIPE guiado', async () => {
      const { deps, tools } = ticketTools('pending', {
        order_id: 501,
        items: [
          {
            product_name: 'Ajiaco',
            has_active_recipe: false,
            components: [],
          },
        ],
        skipped_item_ids: [],
      });
      const tool = getTool(tools, 'transition_kitchen_ticket');

      const preview = await tool.preview!(
        { ticket_id: 77, action: 'start', ticket_status_seen: 'pending' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('KITCHEN_TICKET_NO_RECIPE');
      expect(preview.message).toContain('Ajiaco');

      deps.kitchenFireService.startPreparation.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.KITCHEN_TICKET_NO_RECIPE,
          'sin receta',
        ),
      );
      const { tools: tools2 } = buildTools({
        kitchenFireService: {
          findTicketById: jest.fn().mockResolvedValue({ ...TICKET }),
          startPreparation:
            deps.kitchenFireService.startPreparation,
        },
      });
      const answer = await run(tools2, 'transition_kitchen_ticket', {
        ticket_id: 77,
        action: 'start',
        ticket_status_seen: 'pending',
      });
      expect(answer.error).toContain('KITCHEN_TICKET_NO_RECIPE');
      expect(answer.next_step).toContain('delivered directo');
    });

    it('(e) estado movido entre K-4 y el apply → no transiciona', async () => {
      const { deps, tools } = ticketTools('in_preparation');
      const tool = getTool(tools, 'transition_kitchen_ticket');

      const preview = await tool.preview!(
        { ticket_id: 77, action: 'start', ticket_status_seen: 'pending' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('cambió desde que lo leíste');

      const answer = await run(tools, 'transition_kitchen_ticket', {
        ticket_id: 77,
        action: 'start',
        ticket_status_seen: 'pending',
      });
      expect(answer.error).toContain('cambió desde la confirmación');
      expect(deps.kitchenFireService.startPreparation).not.toHaveBeenCalled();
    });

    it('(a) sad: sin ticket_status_seen → error y cero mutación', async () => {
      const { deps, tools } = ticketTools();

      const answer = await run(tools, 'transition_kitchen_ticket', {
        ticket_id: 77,
        action: 'start',
      });

      expect(answer.error).toContain('exige list_kitchen_tickets');
      expect(deps.kitchenFireService.startPreparation).not.toHaveBeenCalled();
    });
  });

  // ─── Paso 13: K-3 resend ──────────────────────────────────────────
  describe('resend_kitchen_items', () => {
    const TICKETS = {
      data: [
        {
          id: 77,
          status: 'pending',
          order_id: 501,
          items: [
            {
              id: 1,
              order_item_id: 9001,
              quantity: 2,
              status: 'pending',
              product: { name: 'Bandeja paisa' },
            },
          ],
        },
      ],
      total: 1,
    };

    function resendTools(
      tickets: unknown = structuredClone(TICKETS),
      resendResult: unknown = {
        ticketId: 78,
        ticketIds: [78],
        firedItemIds: [9001],
        cancelledTicketIds: [77],
        wasteRefiredItemIds: [],
      },
    ) {
      return buildTools({
        kitchenFireService: {
          findTickets: jest.fn().mockResolvedValue(tickets),
          resendOrderItems: jest.fn().mockResolvedValue(resendResult),
        },
      });
    }

    it('cita su read habilitante en la descripción', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'resend_kitchen_items').description).toMatch(
        /list_kitchen_tickets/,
      );
    });

    it('(b) happy: preview nombra el plato y handler delega (snapshot)', async () => {
      const { deps, tools } = resendTools();
      const tool = getTool(tools, 'resend_kitchen_items');
      const args = {
        order_id: 501,
        order_item_ids: [9001],
        reason: 'lost_command',
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('warning');
      expect(preview.target).toContain('Bandeja paisa');
      expect(preview.target).toContain('orden #501');

      const answer = await run(tools, 'resend_kitchen_items', args);
      expect(
        deps.kitchenFireService.resendOrderItems,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: 501,
          order_item_ids: [9001],
          reason: 'lost_command',
        }),
      );
      expect(answer).toEqual({
        resumen:
          'Reenviados 1 renglón(es) a cocina (ticket #78, motivo lost_command)',
        ticket_id: 78,
        ticket_ids: [78],
        fired_item_ids: [9001],
        cancelled_ticket_ids: [77],
      });
    });

    it('(a) sad: reason inválido → error y cero llamadas', async () => {
      const { deps, tools } = resendTools();
      const tool = getTool(tools, 'resend_kitchen_items');

      const preview = await tool.preview!(
        { order_id: 501, order_item_ids: [9001], reason: 'porque_si' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(deps.kitchenFireService.findTickets).not.toHaveBeenCalled();

      const answer = await run(tools, 'resend_kitchen_items', {
        order_id: 501,
        order_item_ids: [9001],
      });
      expect(answer.error).toContain('exige list_kitchen_tickets');
      expect(deps.kitchenFireService.resendOrderItems).not.toHaveBeenCalled();
    });

    it('(c) sad: renglón fuera del ticket → {error, next_step} sin reenviar', async () => {
      const { deps, tools } = resendTools();
      const tool = getTool(tools, 'resend_kitchen_items');

      const preview = await tool.preview!(
        { order_id: 501, order_item_ids: [4242], reason: 'remake_dish' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('4242');
      expect(deps.kitchenFireService.resendOrderItems).not.toHaveBeenCalled();
    });

    it('(e) re-verificación: ticket cancelado tras el preview → no reenvía', async () => {
      const cancelled = {
        data: [
          { id: 77, status: 'cancelled', order_id: 501, items: [] },
        ],
        total: 1,
      };
      const { deps, tools } = resendTools(cancelled);
      const answer = await run(tools, 'resend_kitchen_items', {
        order_id: 501,
        order_item_ids: [9001],
        reason: 'lost_command',
      });

      expect(answer.error).toContain('ya no están en un ticket activo');
      expect(answer.next_step).toContain('list_kitchen_tickets');
      expect(deps.kitchenFireService.resendOrderItems).not.toHaveBeenCalled();
    });
  });
});
