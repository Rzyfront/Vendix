import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  createComensalTools,
  createTablesTools,
  TablesToolDeps,
} from './tables.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 track A — contrato K-8 `manage_table_session`, K-9 `split_bill`.
 * Paso 13 — K-6 `list_tables`, K-7 `manage_tables`, K-10 `get_table_bill`,
 * K-11 `manage_comensal_request`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca las deps;
 * (b) snapshot JSON exacto de la salida happy; (c) forma
 * `{error, next_step}` en español; (d) permiso declarado por tool;
 * (e) circuito de escritura: los writes llevan `requiresConfirmation` +
 * `preview` con sujeto humano y re-verificación en el handler.
 */
describe('tables.tools · K-6/K-7/K-8/K-9 + comensal K-10/K-11', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  const TABLE_FREE = {
    id: 3,
    name: 'Mesa 3',
    status: 'available',
    active_session: null,
  };

  const SESSION_OPEN = {
    id: 55,
    store_id: 7,
    table_id: 3,
    order_id: 501,
    opened_at: '2026-09-29T12:00:00.000Z',
    closed_at: null,
    guest_count: 2,
    table: { id: 3, name: 'Mesa 3' },
    order: { id: 501, state: 'draft', grand_total: 85000 },
  };

  const SPLIT_PREVIEW = {
    source_order_id: 501,
    split_group_id: null,
    source_version: 'v-abc-1',
    currency: 'COP',
    original_total: '85000.00',
    preserved_paid: '0.00',
    pending_to_split: '85000.00',
    accounts: [
      {
        id: null,
        ordinal: 1,
        role: 'payable',
        label: 'Mesa 3 · A',
        customer_id: null,
        customer_alias: 'A',
        customer_name: null,
        grand_total: '42500.00',
        payment_state: 'unpaid',
      },
      {
        id: null,
        ordinal: 2,
        role: 'payable',
        label: 'Mesa 3 · B',
        customer_id: null,
        customer_alias: 'B',
        customer_name: null,
        grand_total: '42500.00',
        payment_state: 'unpaid',
      },
    ],
    retained_account: null,
    kitchen_fire: null,
  };

  function buildTools(
    overrides: {
      tablesService?: Record<string, any>;
      tableSessionsService?: Record<string, any>;
      splitOrderService?: Record<string, any>;
    } = {},
  ) {
    const deps = {
      tablesService: {
        findOne: jest.fn().mockResolvedValue(structuredClone(TABLE_FREE)),
        findAll: jest.fn(),
        floorMap: jest.fn(),
        getQr: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        ...overrides.tablesService,
      } as any,
      tableSessionsService: {
        openSession: jest.fn(),
        addItems: jest.fn(),
        closeSession: jest.fn(),
        findOne: jest.fn().mockResolvedValue(structuredClone(SESSION_OPEN)),
        ...overrides.tableSessionsService,
      } as any,
      splitOrderService: {
        preview: jest.fn().mockResolvedValue(structuredClone(SPLIT_PREVIEW)),
        splitByItems: jest.fn(),
        splitByAmount: jest.fn(),
        ...overrides.splitOrderService,
      } as any,
    } satisfies TablesToolDeps;
    return { deps, tools: createTablesTools(deps) };
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
    it('expone exactamente las 4 tools del dominio tables (P0 + K-6/K-7)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_tables',
        'manage_tables',
        'manage_table_session',
        'split_bill',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('tables');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('K-8 exige create+update (abre y muta); K-9 exige update', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'manage_table_session').requiredPermissions,
      ).toEqual(['store:table_sessions:create', 'store:table_sessions:update']);
      expect(getTool(tools, 'split_bill').requiredPermissions).toEqual([
        'store:table_sessions:update',
      ]);
    });

    it('K-7/K-8/K-9 son writes con circuito completo; K-6 es readOnly', () => {
      const { tools } = buildTools();
      const list = getTool(tools, 'list_tables');
      expect(list.readOnly).toBe(true);
      expect(list.requiresConfirmation).toBeUndefined();
      expect(list.requiredPermissions).toEqual(['store:tables:read']);
      for (const name of [
        'manage_tables',
        'manage_table_session',
        'split_bill',
      ]) {
        const tool = getTool(tools, name);
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums del JSON Schema', () => {
      const { tools } = buildTools();
      const session = getTool(tools, 'manage_table_session');
      const split = getTool(tools, 'split_bill');
      expect(session.parameters.required).toEqual(['action']);
      expect(session.parameters.properties.action.enum).toEqual([
        'open',
        'add-items',
        'close',
      ]);
      expect(split.parameters.required).toEqual(['order_id', 'mode']);
      expect(split.parameters.properties.mode.enum).toEqual([
        'items',
        'equal',
        'custom',
      ]);
    });
  });

  // ─── K-8 manage_table_session ─────────────────────────────────────
  describe('manage_table_session', () => {
    it('(e) preview open: sujeto humano con nombre de mesa', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_table_session');

      const preview = await tool.preview!(
        { action: 'open', table_id: 3, guest_count: 2 },
        CONTEXT as any,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('Mesa 3');
      expect(preview.changes).toContainEqual({
        field: 'guest_count',
        label: 'Comensales',
        from: null,
        to: 2,
      });
      expect(preview.domain).toBe('tables');
    });

    it('(b) happy open: crea la sesión y resume', async () => {
      const { deps, tools } = buildTools({
        tableSessionsService: {
          openSession: jest.fn().mockResolvedValue(SESSION_OPEN),
        },
      });

      const answer = await run(tools, 'manage_table_session', {
        action: 'open',
        table_id: 3,
        guest_count: 2,
      });

      expect(answer).toEqual({
        resumen: 'Sesión #55 abierta en la mesa Mesa 3',
        session_id: 55,
        table_id: 3,
        order_id: 501,
      });
      expect(deps.tableSessionsService.openSession).toHaveBeenCalledTimes(1);
    });

    it('(c) open sobre mesa ocupada → error en preview y handler', async () => {
      const occupied = { ...TABLE_FREE, active_session: { id: 54 } };
      const { deps, tools } = buildTools({
        tablesService: {
          findOne: jest.fn().mockResolvedValue(occupied),
        },
        tableSessionsService: {
          openSession: jest.fn(),
        },
      });
      const tool = getTool(tools, 'manage_table_session');

      const preview = await tool.preview!(
        { action: 'open', table_id: 3 },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('ya tiene una sesión abierta');

      const answer = await run(tools, 'manage_table_session', {
        action: 'open',
        table_id: 3,
      });
      expect(answer.error).toContain('ya tiene una sesión abierta');
      expect(deps.tableSessionsService.openSession).not.toHaveBeenCalled();
    });

    it('(b) happy add-items: agrega al borrador sin disparar', async () => {
      const { deps, tools } = buildTools({
        tableSessionsService: {
          addItems: jest.fn().mockResolvedValue(SESSION_OPEN),
        },
      });

      const answer = await run(tools, 'manage_table_session', {
        action: 'add-items',
        session_id: 55,
        items: [
          { product_id: 301, quantity: 2, notes: 'sin cebolla' },
          { product_id: 302, quantity: 1 },
        ],
      });

      expect(answer).toEqual({
        resumen:
          'Agregados 2 plato(s) a Mesa 3 (sesión #55) (borrador, sin disparar a cocina)',
        session_id: 55,
        order_id: 501,
      });
      expect(deps.tableSessionsService.addItems).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          items: [
            expect.objectContaining({
              product_id: 301,
              quantity: 2,
              notes: 'sin cebolla',
            }),
            expect.objectContaining({ product_id: 302, quantity: 1 }),
          ],
        }),
      );
    });

    it('(c) close sobre sesión cerrada → {error, next_step}', async () => {
      const closed = { ...SESSION_OPEN, closed_at: '2026-09-29T13:00:00Z' };
      const { deps, tools } = buildTools({
        tableSessionsService: {
          findOne: jest.fn().mockResolvedValue(closed),
          closeSession: jest.fn(),
        },
      });
      const tool = getTool(tools, 'manage_table_session');

      const preview = await tool.preview!(
        { action: 'close', session_id: 55 },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('ya está cerrada');

      const answer = await run(tools, 'manage_table_session', {
        action: 'close',
        session_id: 55,
      });
      expect(answer.error).toContain('ya estaba cerrada');
      expect(answer.next_step).toContain('flujo normal de pago');
      expect(deps.tableSessionsService.closeSession).not.toHaveBeenCalled();
    });

    it('(b) happy close: advierte que no cobra', async () => {
      const { tools } = buildTools({
        tableSessionsService: {
          closeSession: jest
            .fn()
            .mockResolvedValue({ ...SESSION_OPEN, closed_at: 'now' }),
        },
      });
      const tool = getTool(tools, 'manage_table_session');

      const preview = await tool.preview!(
        { action: 'close', session_id: 55 },
        CONTEXT as any,
      );
      expect(preview.status).toBe('warning');
      expect(preview.message).toContain('NO cobra');

      const answer = await run(tools, 'manage_table_session', {
        action: 'close',
        session_id: 55,
      });
      expect(answer.resumen).toContain('cerrada');
      expect(answer.session_id).toBe(55);
    });

    it('(a) sad: sin tienda → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'manage_table_session',
        { action: 'close', session_id: 55 },
        {},
      );

      expect(answer).toEqual({
        error: expect.stringContaining('Sin tienda en contexto'),
      });
      expect(deps.tableSessionsService.findOne).not.toHaveBeenCalled();
      expect(deps.tableSessionsService.closeSession).not.toHaveBeenCalled();
    });
  });

  // ─── K-9 split_bill ───────────────────────────────────────────────
  describe('split_bill', () => {
    const ITEM_GROUPS = [
      { order_item_ids: [9001] },
      { order_item_ids: [9002, 9003] },
    ];

    it('(e) preview items: una cuenta por grupo con totales', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'split_bill');

      const preview = await tool.preview!(
        { order_id: 501, mode: 'items', item_groups: ITEM_GROUPS },
        CONTEXT as any,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toContain('orden #501');
      expect(preview.target).toContain('2 parte(s)');
      expect(preview.changes).toEqual([
        {
          field: 'cuenta:1',
          label: 'Mesa 3 · A',
          from: null,
          to: '42500.00 COP (unpaid)',
        },
        {
          field: 'cuenta:2',
          label: 'Mesa 3 · B',
          from: null,
          to: '42500.00 COP (unpaid)',
        },
      ]);
      expect(preview.message).toContain('Puramente financiero');
    });

    it('(b) happy items: confirma con versión fresca y resume', async () => {
      const confirmed = { ...SPLIT_PREVIEW, split_group_id: 21 };
      const { deps, tools } = buildTools({
        splitOrderService: {
          splitByItems: jest.fn().mockResolvedValue(confirmed),
        },
      });

      const answer = await run(tools, 'split_bill', {
        order_id: 501,
        mode: 'items',
        item_groups: ITEM_GROUPS,
      });

      expect(answer).toEqual({
        resumen:
          'Cuenta #501 dividida en 2 parte(s) (solo financiero, sin movimientos de inventario)',
        order_id: 501,
        split_group_id: 21,
        currency: 'COP',
        pending_to_split: '85000.00',
        accounts: [
          {
            ordinal: 1,
            label: 'Mesa 3 · A',
            customer_alias: 'A',
            grand_total: '42500.00',
            payment_state: 'unpaid',
          },
          {
            ordinal: 2,
            label: 'Mesa 3 · B',
            customer_alias: 'B',
            grand_total: '42500.00',
            payment_state: 'unpaid',
          },
        ],
      });
      // El handler re-calcula el preview al aplicar (source_version fresca)
      // y confirma con idempotency_key propio.
      expect(deps.splitOrderService.preview).toHaveBeenCalled();
      expect(deps.splitOrderService.splitByItems).toHaveBeenCalledWith(
        501,
        expect.objectContaining({
          source_version: 'v-abc-1',
          idempotency_key: expect.any(String),
        }),
      );
    });

    it('(b) happy equal: confirma por monto', async () => {
      const confirmed = { ...SPLIT_PREVIEW, split_group_id: 22 };
      const { deps, tools } = buildTools({
        splitOrderService: {
          splitByAmount: jest.fn().mockResolvedValue(confirmed),
        },
      });

      const answer = await run(tools, 'split_bill', {
        order_id: 501,
        mode: 'equal',
        n_splits: 2,
      });

      expect(answer.split_group_id).toBe(22);
      expect(deps.splitOrderService.splitByAmount).toHaveBeenCalledWith(
        501,
        expect.objectContaining({ n_splits: 2 }),
      );
    });

    it('(a) sad: items sin grupos → error y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'split_bill', {
        order_id: 501,
        mode: 'items',
      });

      expect(answer.error).toContain('item_groups');
      expect(deps.splitOrderService.preview).not.toHaveBeenCalled();
      expect(deps.splitOrderService.splitByItems).not.toHaveBeenCalled();
    });

    it('(c) cuenta movida tras el preview → el servicio rechaza guiado', async () => {
      const { tools } = buildTools({
        splitOrderService: {
          splitByItems: jest
            .fn()
            .mockRejectedValue(
              new VendixHttpException(
                ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
                'la cuenta cambió tras el preview',
              ),
            ),
        },
      });

      const answer = await run(tools, 'split_bill', {
        order_id: 501,
        mode: 'items',
        item_groups: ITEM_GROUPS,
      });

      expect(answer.error).toContain('No pude dividir la cuenta');
      expect(answer.next_step).toContain('tras la confirmación');
    });
  });

  // ─── Paso 13: K-6 list_tables ────────────────────────────────────
  describe('list_tables', () => {
    const FLOOR = [
      {
        id: 3,
        name: 'Mesa 3',
        zone: 'Terraza',
        status: 'available',
        capacity: 4,
        pos_x: 10,
        pos_y: 20,
        active_session: null,
      },
      {
        id: 4,
        name: 'Mesa 4',
        zone: 'Terraza',
        status: 'occupied',
        capacity: 2,
        pos_x: 30,
        pos_y: 20,
        active_session: { id: 55 },
      },
    ];

    it('(b) happy plano: conteo por estado + session_open (snapshot)', async () => {
      const floorMap = jest.fn().mockResolvedValue(structuredClone(FLOOR));
      const { tools } = buildTools({ tablesService: { floorMap } });

      const answer = await run(tools, 'list_tables', {});

      expect(floorMap).toHaveBeenCalled();
      expect(answer).toEqual({
        resumen: 'Plano: 2 mesa(s)',
        por_estado: { available: 1, occupied: 1 },
        mesas: [
          {
            table_id: 3,
            name: 'Mesa 3',
            zone: 'Terraza',
            status: 'available',
            capacity: 4,
            pos_x: 10,
            pos_y: 20,
            session_open: false,
          },
          {
            table_id: 4,
            name: 'Mesa 4',
            zone: 'Terraza',
            status: 'occupied',
            capacity: 2,
            pos_x: 30,
            pos_y: 20,
            session_open: true,
          },
        ],
      });
    });

    it('(b) happy detalle: mesa + QR', async () => {
      const { tools } = buildTools({
        tablesService: {
          findOne: jest.fn().mockResolvedValue({
            ...TABLE_FREE,
            zone: 'Terraza',
            capacity: 4,
            pos_x: 10,
            pos_y: 20,
          }),
          getQr: jest.fn().mockResolvedValue({
            public_url: 'https://tienda.vendix.co/m/abc',
            qr_data_url: 'data:image/png;base64,AAA',
          }),
        },
      });

      const answer = await run(tools, 'list_tables', { table_id: 3 });

      expect(answer.mesa.name).toBe('Mesa 3');
      expect(answer.qr.public_url).toContain('/m/abc');
      expect(answer.next_step).toMatch(/manage_table_session/);
    });

    it('(a) sad: status inválido no toca el servicio', async () => {
      const floorMap = jest.fn();
      const findAll = jest.fn();
      const { tools } = buildTools({
        tablesService: { floorMap, findAll },
      });

      const answer = await run(tools, 'list_tables', { status: 'volando' });

      expect(answer.error).toContain('inválido');
      expect(floorMap).not.toHaveBeenCalled();
      expect(findAll).not.toHaveBeenCalled();
    });
  });

  // ─── Paso 13: K-7 manage_tables ──────────────────────────────────
  describe('manage_tables', () => {
    it('contrato: permisos CRUD + cita su read habilitante', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_tables');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:tables:create',
        'store:tables:update',
        'store:tables:delete',
      ]);
      expect(tool.description).toMatch(/list_tables/);
    });

    it('(b) happy create: preview con nombre y handler delega (snapshot)', async () => {
      const create = jest
        .fn()
        .mockResolvedValue({ id: 9, name: 'Mesa 9', zone: 'Terraza' });
      const { tools } = buildTools({ tablesService: { create } });
      const tool = getTool(tools, 'manage_tables');
      const args = {
        action: 'create',
        name: 'Mesa 9',
        zone: 'Terraza',
        capacity: 4,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Creación de mesa — "Mesa 9"');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT as any));
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mesa 9', capacity: 4 }),
      );
      expect(answer).toEqual({
        resumen: 'Mesa "Mesa 9" creada (#9)',
        table_id: 9,
      });
    });

    it('(e) remove con sesión abierta se rechaza; cerrada sí procede', async () => {
      const remove = jest.fn().mockResolvedValue({ id: 3 });
      const busy = buildTools({
        tablesService: {
          findOne: jest.fn().mockResolvedValue({
            ...TABLE_FREE,
            active_session: { id: 55 },
          }),
          remove,
        },
      });
      const tool = getTool(busy.tools, 'manage_tables');

      const blocked = await tool.preview!(
        { action: 'remove', table_id: 3 },
        CONTEXT as any,
      );
      expect(blocked.status).toBe('error');
      expect(blocked.message).toContain('sesión abierta');
      expect(remove).not.toHaveBeenCalled();

      const free = buildTools({
        tablesService: {
          findOne: jest.fn().mockResolvedValue(TABLE_FREE),
          remove,
        },
      });
      const answer = JSON.parse(
        await getTool(free.tools, 'manage_tables').handler!(
          { action: 'remove', table_id: 3 },
          CONTEXT as any,
        ),
      );
      expect(remove).toHaveBeenCalledWith(3);
      expect(answer.resumen).toContain('eliminada');
    });
  });

  // ─── Paso 13: comensal K-10/K-11 ──────────────────────────────────
  describe('comensal: get_table_bill / manage_comensal_request', () => {
    const BILL = {
      table: { id: 3, name: 'Mesa 3' },
      session_id: 55,
      order_id: 501,
      items: [
        {
          product_name: 'Bandeja paisa',
          quantity: 2,
          unit_price: 32000,
          total: 64000,
        },
      ],
      subtotal: 64000,
      tax_amount: 0,
      grand_total: 64000,
      total_paid: 0,
      balance_due: 64000,
      currency: 'COP',
    };
    const METHODS = [
      { id: 1, type: 'cash', name: 'Efectivo', requires_reference: false },
    ];

    function comensalTools(
      overrides: Record<string, any> = {},
    ): RegisteredTool[] {
      return createComensalTools({
        ecommerceTablesService: {
          getBill: jest.fn().mockResolvedValue(structuredClone(BILL)),
          getTablePaymentMethods: jest
            .fn()
            .mockResolvedValue(structuredClone(METHODS)),
          callWaiter: jest.fn().mockResolvedValue({ ok: true }),
          requestBill: jest.fn().mockResolvedValue({ ok: true }),
          requestSplit: jest.fn().mockResolvedValue({ ok: true }),
          ...overrides,
        } as any,
      });
    }

    it('contrato: K-10 readOnly, K-11 write; factory separada de 2 tools', () => {
      const tools = comensalTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_table_bill',
        'manage_comensal_request',
      ]);
      const bill = getTool(tools, 'get_table_bill');
      expect(bill.readOnly).toBe(true);
      expect(bill.requiredPermissions).toEqual(['store:tables:read']);
      const request = getTool(tools, 'manage_comensal_request');
      expect(request.requiresConfirmation).toBe(true);
      expect(typeof request.preview).toBe('function');
      expect(request.requiredPermissions).toEqual(['store:tables:update']);
      expect(request.description).toMatch(/NUNCA cobra/);
      expect(request.description).toMatch(/get_table_bill/);
    });

    it('(b) happy K-10: cuenta + medios (snapshot, sin resolver el token)', async () => {
      const getBill = jest.fn().mockResolvedValue(structuredClone(BILL));
      const getTablePaymentMethods = jest
        .fn()
        .mockResolvedValue(structuredClone(METHODS));
      const resolveByToken = jest.fn();
      const tools = comensalTools({
        getBill,
        getTablePaymentMethods,
        resolveByToken,
      });

      const answer = await run(tools, 'get_table_bill', { token: 'qr-abc' });

      // readOnly puro: jamás resuelve el token (resolver abre sesión).
      expect(resolveByToken).not.toHaveBeenCalled();
      expect(answer).toEqual({
        mesa: { table_id: 3, name: 'Mesa 3', session_id: 55, order_id: 501 },
        cuenta: {
          items: [
            {
              product_name: 'Bandeja paisa',
              quantity: 2,
              unit_price: 32000,
              total: 64000,
            },
          ],
          subtotal: 64000,
          tax_amount: 0,
          grand_total: 64000,
          total_paid: 0,
          balance_due: 64000,
          currency: 'COP',
        },
        medios_de_pago: [
          {
            id: 1,
            type: 'cash',
            name: 'Efectivo',
            requires_reference: false,
          },
        ],
        next_step: expect.stringContaining('manage_comensal_request'),
      });
    });

    it('(a) sad K-10: token de otra tienda → {error, next_step}', async () => {
      const tools = comensalTools({
        getBill: jest
          .fn()
          .mockRejectedValue(
            new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND),
          ),
      });

      const answer = await run(tools, 'get_table_bill', { token: 'otro' });

      expect(answer.error).toContain('ninguna mesa de esta tienda');
      expect(answer.next_step).toContain('list_tables');
    });

    it('(b+e) happy K-11 call-waiter: preview nombra la mesa, nada se cobra', async () => {
      const callWaiter = jest.fn().mockResolvedValue({ ok: true });
      const tools = comensalTools({ callWaiter });
      const tool = getTool(tools, 'manage_comensal_request');
      const args = { token: 'qr-abc', action: 'call-waiter', note: 'sin hielo' };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('Mesa 3');
      expect(preview.message).toContain('no cobra');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT as any));
      expect(callWaiter).toHaveBeenCalledWith('qr-abc', 'sin hielo');
      expect(answer.resumen).toContain('nada se cobró');
    });

    it('(a) sad K-11: request-split sin n_splits no toca el servicio', async () => {
      const requestSplit = jest.fn();
      const tools = comensalTools({ requestSplit });
      const tool = getTool(tools, 'manage_comensal_request');

      const preview = await tool.preview!(
        { token: 'qr-abc', action: 'request-split', mode: 'equal' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('n_splits');
      expect(requestSplit).not.toHaveBeenCalled();
    });
  });
});
