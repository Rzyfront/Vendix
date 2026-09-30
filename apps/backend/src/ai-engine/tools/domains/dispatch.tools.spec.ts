import {
  createDispatchTools,
  DispatchToolDeps,
} from './dispatch.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 8 — contrato D-1 / D-3 / D-5 (dispatch).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) requiresConfirmation +
 * preview con sujeto humano en writes, con re-verificación en el handler.
 * La parada es binaria: `partial` se rechaza en el borde (preview Y handler)
 * sin tocar el servicio, con código DISPATCH_ROUTE_PARTIAL_DISABLED.
 */
describe('dispatch.tools · D-1 list / D-3 transition / D-5 notes', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: {
    dispatchRoutesService?: Record<string, any>;
    routeFlowService?: Record<string, any>;
    dispatchNotesService?: Record<string, any>;
    vehiclesService?: Record<string, any>;
  } = {}) {
    const deps = {
      dispatchRoutesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        getStats: jest.fn(),
        getMonitor: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        addStops: jest.fn(),
        getMapStops: jest.fn(),
        ...overrides.dispatchRoutesService,
      } as any,
      routeFlowService: {
        dispatch: jest.fn(),
        startStop: jest.fn(),
        settleStop: jest.fn(),
        releaseStop: jest.fn(),
        close: jest.fn(),
        void: jest.fn(),
        generatePdf: jest.fn(),
        ...overrides.routeFlowService,
      } as any,
      dispatchNotesService: {
        findOne: jest.fn(),
        findAll: jest.fn(),
        getStats: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        createFromOrder: jest.fn(),
        createFromOrdersBatch: jest.fn(),
        validateFromOrdersBatch: jest.fn(),
        ...overrides.dispatchNotesService,
      } as any,
      vehiclesService: {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        ...overrides.vehiclesService,
      } as any,
    } satisfies DispatchToolDeps;
    return { deps, tools: createDispatchTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const STOP_PENDING = {
    id: 31,
    stop_sequence: 1,
    status: 'pending',
    result: null,
    is_extra_route: false,
    is_prepaid: false,
    dispatch_note_id: 101,
    collected_amount: '0',
    anticipo_amount: '0',
    change_amount: '0',
    withholding_amount: '0',
    payment_method: 'cash',
    settled_at: null,
    released_at: null,
    dispatch_note: {
      dispatch_number: 'REM-0101',
      grand_total: '250000',
      customer_name: 'Tienda El Sol',
    },
  };

  const STOP_DELIVERED = {
    ...STOP_PENDING,
    id: 32,
    stop_sequence: 2,
    status: 'delivered',
    result: 'delivered',
    dispatch_note_id: 102,
    collected_amount: '180000',
    dispatch_note: {
      dispatch_number: 'REM-0102',
      grand_total: '180000',
      customer_name: 'Mercado Norte',
    },
  };

  const ROUTE_DRAFT = {
    id: 9,
    route_number: 'PLN2601010009',
    route_code: 'RI02',
    status: 'draft',
    planned_date: '2026-01-10T00:00:00.000Z',
    is_primary_driver_external: false,
    driver_user: { first_name: 'Pedro', last_name: 'Pérez' },
    vehicle: { plate: 'ABC123' },
    _count: { stops: 2 },
    total_to_collect: '430000',
    total_collected: '0',
    total_prepaid: '0',
    cash_variance: null,
    dispatch_started_at: null,
    closed_at: null,
    declared_cash: null,
    stops: [STOP_PENDING, { ...STOP_PENDING, id: 33, stop_sequence: 2 }],
    reconciliation: { por_cobrar: 430000, cobrado: 0 },
  };

  describe('contrato de familia', () => {
    it('declara version 1 en las 7 tools', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_dispatch_routes',
        'manage_dispatch_route',
        'transition_route_stop',
        'manage_dispatch_notes',
        'get_route_map',
        'list_dispatch_notes',
        'manage_vehicles',
      ]);
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.domain).toBe('dispatch');
      }
    });

    it('D-1 es readOnly con permiso de lectura', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'list_dispatch_routes');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(tool.requiredPermissions).toEqual(['store:dispatch_routes:read']);
    });

    it('D-3 y D-5 exigen confirmación + preview y declaran sus permisos', () => {
      const { tools } = buildTools();
      const transition = getTool(tools, 'transition_route_stop');
      expect(transition.requiresConfirmation).toBe(true);
      expect(typeof transition.preview).toBe('function');
      expect(transition.requiredPermissions).toEqual([
        'store:dispatch_routes:dispatch',
        'store:dispatch_routes:settle',
        'store:dispatch_routes:release_stop',
        'store:dispatch_routes:close',
        'store:dispatch_routes:void',
      ]);
      const notes = getTool(tools, 'manage_dispatch_notes');
      expect(notes.requiresConfirmation).toBe(true);
      expect(typeof notes.preview).toBe('function');
      expect(notes.requiredPermissions).toEqual([
        'store:dispatch_notes:create',
        'store:dispatch_notes:update',
        'store:dispatch_notes:delete',
      ]);
    });
  });

  describe('list_dispatch_routes (D-1)', () => {
    it('happy: lista compacta con paginación (snapshot)', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findAll: jest.fn().mockResolvedValue({
            data: [ROUTE_DRAFT],
            pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
          }),
        },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(
        await tool.handler!({ status: 'draft' }, CONTEXT),
      );

      expect(answer).toEqual({
        resumen: '1 planilla(s) de 1 en total',
        pagina: 1,
        paginas: 1,
        planillas: [
          {
            route_id: 9,
            route_number: 'PLN2601010009',
            route_code: 'RI02',
            status: 'draft',
            planned_date: '2026-01-10T00:00:00.000Z',
            driver: 'Pedro Pérez',
            vehicle_plate: 'ABC123',
            stops_count: 2,
            total_to_collect: 430000,
            total_collected: 0,
            total_prepaid: 0,
            cash_variance: null,
          },
        ],
      });
    });

    it('happy: route_id devuelve detalle con paradas + conciliación (cadena D-3)', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue(ROUTE_DRAFT),
        },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(
        await tool.handler!({ route_id: 9 }, CONTEXT),
      );

      expect(answer.planilla.route_number).toBe('PLN2601010009');
      expect(answer.planilla.paradas).toHaveLength(2);
      expect(answer.planilla.paradas[0]).toEqual({
        stop_id: 31,
        stop_sequence: 1,
        status: 'pending',
        result: null,
        is_extra_route: false,
        is_prepaid: false,
        dispatch_note_id: 101,
        dispatch_number: 'REM-0101',
        customer: 'Tienda El Sol',
        grand_total: 250000,
        collected_amount: 0,
        anticipo_amount: 0,
        change_amount: 0,
        withholding_amount: 0,
        payment_method: 'cash',
        settled_at: null,
        released_at: null,
      });
      expect(answer.planilla.paradas_sin_liquidar).toBe(2);
      expect(answer.planilla.conciliacion).toEqual({
        por_cobrar: 430000,
        cobrado: 0,
      });
    });

    it('happy: include_stats/include_monitor agregan secciones', async () => {
      const getStats = jest.fn().mockResolvedValue({ total: 4, draft: 1 });
      const getMonitor = jest.fn().mockResolvedValue({
        data: [{ id: 9, margen_flete: 50000 }],
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      const { tools } = buildTools({
        dispatchRoutesService: {
          findAll: jest.fn().mockResolvedValue({
            data: [],
            pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
          }),
          getStats,
          getMonitor,
        },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(
        await tool.handler!(
          { include_stats: true, include_monitor: true },
          CONTEXT,
        ),
      );

      expect(answer.stats).toEqual({ total: 4, draft: 1 });
      expect(answer.monitor.filas).toEqual([{ id: 9, margen_flete: 50000 }]);
      expect(getStats).toHaveBeenCalled();
      expect(getMonitor).toHaveBeenCalled();
    });

    it('happy: sin flags no toca stats ni monitor', async () => {
      const getStats = jest.fn();
      const getMonitor = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: {
          findAll: jest.fn().mockResolvedValue({
            data: [],
            pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
          }),
          getStats,
          getMonitor,
        },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(await tool.handler!({}, CONTEXT));

      expect(answer.stats).toBeUndefined();
      expect(answer.monitor).toBeUndefined();
      expect(getStats).not.toHaveBeenCalled();
      expect(getMonitor).not.toHaveBeenCalled();
    });

    it('sad: status inválido no llama al servicio', async () => {
      const findAll = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: { findAll },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(
        await tool.handler!({ status: 'settling' }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
      expect(findAll).not.toHaveBeenCalled();
    });

    it('sad: sin tenant responde error acotado', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(await tool.handler!({}, {}));

      expect(answer.error).toMatch(/tienda/);
    });

    it('sad: planilla inexistente responde {error, next_step}', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest
            .fn()
            .mockRejectedValue(new Error('Planilla #999 no encontrada')),
        },
      });
      const tool = getTool(tools, 'list_dispatch_routes');
      const answer = JSON.parse(
        await tool.handler!({ route_id: 999 }, CONTEXT),
      );

      expect(answer.error).toMatch(/999/);
      expect(answer.next_step).toMatch(/list_dispatch_routes/);
    });
  });

  describe('transition_route_stop (D-3) · preview', () => {
    it('preview dispatch nombra la planilla humana y bloquea paradas', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue(ROUTE_DRAFT),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'dispatch', route_id: 9 },
        CONTEXT,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Planilla PLN2601010009 (2 parada(s))');
      expect(preview.changes).toEqual([
        {
          field: 'status',
          label: 'Estado',
          from: 'draft',
          to: 'dispatched (bloquea la lista de paradas)',
        },
      ]);
      expect(preview.domain).toBe('dispatch');
    });

    it('preview dispatch fuera de draft aborta', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...ROUTE_DRAFT, status: 'dispatched' }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'dispatch', route_id: 9 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/draft/);
    });

    it('preview start proyecta in_transit automático', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'dispatched',
            stops: [STOP_PENDING],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'start', route_id: 9, stop_id: 31 },
        CONTEXT,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toBe(
        'Planilla PLN2601010009 — parada 1 (REM-0101)',
      );
      expect(preview.changes).toEqual([
        {
          field: 'stop_status',
          label: 'Parada',
          from: 'pending',
          to: 'in_progress',
        },
        {
          field: 'route_status',
          label: 'Planilla',
          from: 'dispatched',
          to: 'in_transit (automático al primer start)',
        },
      ]);
    });

    it('preview settle delivered con pago total (snapshot)', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_PENDING],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        {
          action: 'settle',
          route_id: 9,
          stop_id: 31,
          result: 'delivered',
          collected_amount: 250000,
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Planilla PLN2601010009 — parada 1 (REM-0101)',
        changes: [
          {
            field: 'result',
            label: 'Resultado',
            from: 'pending',
            to: 'delivered',
          },
          {
            field: 'collected_amount',
            label: 'Cobrado',
            from: 0,
            to: 250000,
          },
        ],
        message:
          'Al liquidar se emite payment.received (caja/cartera/comisiones) y, si hay vueltas, refund.completed. Sin crédito en ruta.',
        domain: 'dispatch',
      });
    });

    it('preview settle con partial se rechaza en el borde sin leer la ruta', async () => {
      const findOne = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: { findOne },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        {
          action: 'settle',
          route_id: 9,
          stop_id: 31,
          result: 'partial',
          collected_amount: 100000,
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/DISPATCH_ROUTE_PARTIAL_DISABLED/);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('preview settle con pago corto exige total o rejected', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_PENDING],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        {
          action: 'settle',
          route_id: 9,
          stop_id: 31,
          result: 'delivered',
          collected_amount: 100000,
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/Pago incompleto/);
      expect(preview.message).toMatch(/rejected/);
    });

    it('preview release sin reason aborta', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_PENDING],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'release', route_id: 9, stop_id: 31 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/reason/);
    });

    it('preview close con paradas sin liquidar aborta', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_PENDING, STOP_DELIVERED],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'close', route_id: 9, declared_cash: 180000 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/1 parada\(s\) sin liquidar/);
    });

    it('preview close proyecta varianza con warning', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_DELIVERED],
          }),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const preview = await tool.preview!(
        { action: 'close', route_id: 9, declared_cash: 175000 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Planilla PLN2601010009');
      expect(preview.changes).toContainEqual({
        field: 'cash_variance',
        label: 'Varianza proyectada',
        from: null,
        to: -5000,
      });
      expect(preview.message).toMatch(/Faltante/);
    });

    it('preview void exige reason ≥3 y advierte terminal', async () => {
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue(ROUTE_DRAFT),
        },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const short = await tool.preview!(
        { action: 'void', route_id: 9, reason: 'x' },
        CONTEXT,
      );
      expect(short.status).toBe('error');

      const ok = await tool.preview!(
        { action: 'void', route_id: 9, reason: 'ruta duplicada' },
        CONTEXT,
      );
      expect(ok.status).toBe('warning');
      expect(ok.target).toBe('Planilla PLN2601010009');
    });
  });

  describe('transition_route_stop (D-3) · handler', () => {
    it('happy dispatch delega en el servicio dueño', async () => {
      const dispatch = jest.fn().mockResolvedValue({
        route_number: 'PLN2601010009',
        stops: [{}, {}],
      });
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue(ROUTE_DRAFT),
        },
        routeFlowService: { dispatch },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const answer = JSON.parse(
        await tool.handler!({ action: 'dispatch', route_id: 9 }, CONTEXT),
      );

      expect(dispatch).toHaveBeenCalledWith(9);
      expect(answer.transicion).toBe('draft → dispatched');
      expect(answer.next_step).toMatch(/settle/);
    });

    it('happy settle delega con DTO validado', async () => {
      const settleStop = jest.fn().mockResolvedValue({
        result: 'delivered',
        collected_amount: '250000',
        change_amount: '0',
        withholding_amount: '0',
      });
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_PENDING],
          }),
        },
        routeFlowService: { settleStop },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'settle',
            route_id: 9,
            stop_id: 31,
            result: 'delivered',
            collected_amount: 250000,
          },
          CONTEXT,
        ),
      );

      expect(settleStop).toHaveBeenCalledWith(
        9,
        31,
        expect.objectContaining({ result: 'delivered' }),
      );
      expect(answer.resultado).toBe('delivered');
      expect(answer.remision).toBe('REM-0101');
    });

    it('handler rechaza partial con código sin tocar servicios', async () => {
      const settleStop = jest.fn();
      const findOne = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: { findOne },
        routeFlowService: { settleStop },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'settle',
            route_id: 9,
            stop_id: 31,
            result: 'partial',
            collected_amount: 100000,
          },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/parciales/);
      expect(answer.code).toBe('DISPATCH_ROUTE_PARTIAL_DISABLED');
      expect(answer.next_step).toMatch(/rejected/);
      expect(settleStop).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
    });

    it('re-verificación: parada liquidada tras el preview aborta sin mutar', async () => {
      const settleStop = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_DELIVERED],
          }),
        },
        routeFlowService: { settleStop },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'settle',
            route_id: 9,
            stop_id: 32,
            result: 'delivered',
            collected_amount: 180000,
          },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/delivered/);
      expect(settleStop).not.toHaveBeenCalled();
    });

    it('happy close delega y reporta varianza persistida', async () => {
      const close = jest.fn().mockResolvedValue({
        route_number: 'PLN2601010009',
        declared_cash: '180000',
        total_collected: '180000',
        cash_variance: '0',
      });
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue({
            ...ROUTE_DRAFT,
            status: 'in_transit',
            stops: [STOP_DELIVERED],
          }),
        },
        routeFlowService: { close },
      });
      const tool = getTool(tools, 'transition_route_stop');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'close', route_id: 9, declared_cash: 180000 },
          CONTEXT,
        ),
      );

      expect(close).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ declared_cash: 180000 }),
      );
      expect(answer.transicion).toBe('→ closed');
      expect(answer.varianza).toBe(0);
    });
  });

  describe('manage_dispatch_notes (D-5)', () => {
    const NOTE_DRAFT = {
      id: 101,
      dispatch_number: 'REM-0101',
      status: 'draft',
      direction: 'outbound',
      subtype: 'customer_delivery',
      customer_name: 'Tienda El Sol',
      grand_total: '250000',
      order_id: 55,
      emission_date: '2026-01-09T00:00:00.000Z',
      agreed_delivery_date: null,
      notes: null,
      dispatch_note_items: [{}, {}],
    };

    it('preview create_from_order nombra la orden y valida el DTO', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_dispatch_notes');
      const preview = await tool.preview!(
        {
          action: 'create_from_order',
          order_id: 55,
          items: [{ order_item_id: 7, dispatched_quantity: 3 }],
          target_status: 'confirmed',
        },
        CONTEXT,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Nueva remisión desde orden #55');
      expect(preview.changes).toContainEqual({
        field: 'items',
        label: 'Líneas',
        from: null,
        to: '1 línea(s), 3 unidad(es)',
      });
    });

    it('preview create_from_order con items inválidos aborta en validación', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_dispatch_notes');
      const preview = await tool.preview!(
        {
          action: 'create_from_order',
          order_id: 55,
          items: [{ order_item_id: 7, dispatched_quantity: 0 }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/validación/);
    });

    it('preview batch con stock corto advierte con el detalle por orden', async () => {
      const validateFromOrdersBatch = jest.fn().mockResolvedValue({
        ok: false,
        issues: [
          {
            order_id: 56,
            product_id: 12,
            missing_units: 4,
            reason: 'no_stock',
          },
        ],
      });
      const { tools } = buildTools({
        dispatchNotesService: { validateFromOrdersBatch },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const preview = await tool.preview!(
        { action: 'create_from_orders_batch', orders: [55, 56] },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Lote de 2 remisión(es) desde órdenes');
      expect(preview.message).toMatch(/orden #56/);
      expect(preview.message).toMatch(/faltan 4/);
      expect(validateFromOrdersBatch).toHaveBeenCalledWith([55, 56]);
    });

    it('preview batch vacío aborta sin validar stock', async () => {
      const validateFromOrdersBatch = jest.fn();
      const { tools } = buildTools({
        dispatchNotesService: { validateFromOrdersBatch },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const preview = await tool.preview!(
        { action: 'create_from_orders_batch', orders: [] },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(validateFromOrdersBatch).not.toHaveBeenCalled();
    });

    it('preview update muestra from→to con sujeto humano (snapshot)', async () => {
      const { tools } = buildTools({
        dispatchNotesService: {
          findOne: jest.fn().mockResolvedValue(NOTE_DRAFT),
        },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const preview = await tool.preview!(
        {
          action: 'update',
          dispatch_note_id: 101,
          notes: 'Entregar en la mañana',
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Remisión REM-0101 — Tienda El Sol',
        changes: [
          {
            field: 'notes',
            label: 'Notas',
            from: null,
            to: 'Entregar en la mañana',
          },
        ],
        domain: 'dispatch',
      });
    });

    it('preview update/remove fuera de borrador aborta', async () => {
      const { tools } = buildTools({
        dispatchNotesService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...NOTE_DRAFT, status: 'confirmed' }),
        },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const update = await tool.preview!(
        { action: 'update', dispatch_note_id: 101, notes: 'x' },
        CONTEXT,
      );
      const remove = await tool.preview!(
        { action: 'remove', dispatch_note_id: 101 },
        CONTEXT,
      );

      expect(update.status).toBe('error');
      expect(update.message).toMatch(/borrador/);
      expect(remove.status).toBe('error');
      expect(remove.message).toMatch(/borrador/);
    });

    it('handler create_from_order delega en el servicio', async () => {
      const createFromOrder = jest.fn().mockResolvedValue(NOTE_DRAFT);
      const { tools } = buildTools({
        dispatchNotesService: { createFromOrder },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'create_from_order',
            order_id: 55,
            items: [{ order_item_id: 7, dispatched_quantity: 3 }],
          },
          CONTEXT,
        ),
      );

      expect(createFromOrder).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          items: [expect.objectContaining({ order_item_id: 7 })],
        }),
      );
      expect(answer.remision.dispatch_number).toBe('REM-0101');
      expect(answer.next_step).toMatch(/planilla/);
    });

    it('handler batch reporta parcial por orden', async () => {
      const createFromOrdersBatch = jest.fn().mockResolvedValue({
        results: [
          {
            status: 'created',
            order_id: 55,
            dispatch_note_id: 101,
            dispatch_number: 'REM-0101',
          },
          {
            status: 'failed',
            order_id: 56,
            error_code: 'DSP_BATCH_ORDER_FAIL',
            message: 'sin stock',
          },
        ],
        route_id: null,
        partial: true,
      });
      const { tools } = buildTools({
        dispatchNotesService: { createFromOrdersBatch },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'create_from_orders_batch', orders: [55, 56] },
          CONTEXT,
        ),
      );

      expect(answer.creadas).toBe(1);
      expect(answer.de).toBe(2);
      expect(answer.parcial).toBe(true);
      expect(answer.resultados).toHaveLength(2);
      expect(answer.next_step).toMatch(/fallida/);
    });

    it('re-verificación: remisión confirmada tras el preview aborta update sin mutar', async () => {
      const update = jest.fn();
      const { tools } = buildTools({
        dispatchNotesService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...NOTE_DRAFT, status: 'confirmed' }),
          update,
        },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', dispatch_note_id: 101, notes: 'tarde' },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/borrador/);
      expect(update).not.toHaveBeenCalled();
    });

    it('happy remove delega tras re-verificar borrador', async () => {
      const remove = jest.fn().mockResolvedValue({ id: 101 });
      const { tools } = buildTools({
        dispatchNotesService: {
          findOne: jest.fn().mockResolvedValue(NOTE_DRAFT),
          remove,
        },
      });
      const tool = getTool(tools, 'manage_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'remove', dispatch_note_id: 101 },
          CONTEXT,
        ),
      );

      expect(remove).toHaveBeenCalledWith(101);
      expect(answer.eliminada).toBe(true);
    });
  });

  // ─── Paso 13: D-2/D-4/D-6/D-7 ────────────────────────────────────
  describe('manage_dispatch_route (D-2)', () => {
    const ARGS_CREATE = {
      action: 'create',
      route_code: 'RI02',
      planned_date: '2026-01-10',
      vehicle_id: 4,
      driver_user_id: 11,
      stops: [{ dispatch_note_id: 101 }, { dispatch_note_id: 102 }],
    };

    it('contrato: confirmación + preview + permisos CRUD', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_dispatch_route');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:dispatch_routes:create',
        'store:dispatch_routes:update',
        'store:dispatch_routes:delete',
      ]);
      expect(tool.description).toMatch(/list_dispatch_routes/);
    });

    it('happy create: preview lista paradas y handler delega (snapshot)', async () => {
      const create = jest
        .fn()
        .mockResolvedValue({ ...ROUTE_DRAFT, id: 10 });
      const { tools } = buildTools({
        dispatchRoutesService: { create },
      });
      const tool = getTool(tools, 'manage_dispatch_route');

      const preview = await tool.preview!(ARGS_CREATE, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toMatch(/RI02/);
      expect(preview.target).toMatch(/2 parada/);

      const answer = JSON.parse(
        await tool.handler!(ARGS_CREATE, CONTEXT),
      );
      expect(create).toHaveBeenCalled();
      const dto = create.mock.calls[0][0];
      expect(dto.route_code).toBe('RI02');
      expect(dto.stops).toHaveLength(2);
      expect(dto.stops[0]).toMatchObject({
        dispatch_note_id: 101,
        stop_sequence: 1,
      });
      expect(answer).toEqual({
        resumen:
          'Planilla PLN2601010009 creada en borrador con 2 parada(s). Despáchala con transition_route_stop(dispatch).',
        route_id: 10,
      });
    });

    it('sad: editar una ruta despachada se rechaza sin tocar el servicio', async () => {
      const update = jest.fn();
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...ROUTE_DRAFT, status: 'dispatched' }),
          update,
        },
      });
      const tool = getTool(tools, 'manage_dispatch_route');

      const preview = await tool.preview!(
        { action: 'update', route_id: 9, route_code: 'RI03' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/borrador/);

      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', route_id: 9, route_code: 'RI03' },
          CONTEXT,
        ),
      );
      expect(answer.error).toMatch(/dispatched/);
      expect(update).not.toHaveBeenCalled();
    });

    it('happy add-stops delega con DTO real', async () => {
      const addStops = jest
        .fn()
        .mockResolvedValue({ ...ROUTE_DRAFT, stops: [{}, {}, {}] });
      const { tools } = buildTools({
        dispatchRoutesService: {
          findOne: jest.fn().mockResolvedValue(ROUTE_DRAFT),
          addStops,
        },
      });
      const tool = getTool(tools, 'manage_dispatch_route');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'add-stops',
            route_id: 9,
            stops: [{ dispatch_note_id: 103 }],
          },
          CONTEXT,
        ),
      );

      expect(addStops).toHaveBeenCalledWith(
        9,
        expect.objectContaining({
          stops: [{ dispatch_note_id: 103 }],
        }),
      );
      expect(answer.resumen).toMatch(/1 parada\(s\) agregada/);
    });
  });

  describe('get_route_map (D-4)', () => {
    const MAP = {
      origin: { lat: 4.71, lng: -74.07 },
      stops: [
        {
          stop_id: 31,
          stop_sequence: 1,
          lat: 4.72,
          lng: -74.08,
          customer: 'Tienda El Sol',
        },
      ],
      delivered: [{ stop_id: 32 }],
      unlocated: [
        { dispatchNoteId: 104, customerAddress: 'Vereda El Hato' },
      ],
    };

    it('contrato: readOnly con permiso de lectura', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'get_route_map');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(tool.requiredPermissions).toEqual([
        'store:dispatch_routes:read',
      ]);
    });

    it('happy: mapa con ubicadas y sin-ubicar (snapshot)', async () => {
      const getMapStops = jest.fn().mockResolvedValue(MAP);
      const { tools } = buildTools({
        dispatchRoutesService: { getMapStops },
      });
      const tool = getTool(tools, 'get_route_map');
      const answer = JSON.parse(
        await tool.handler!({ route_id: 9 }, CONTEXT),
      );

      expect(getMapStops).toHaveBeenCalledWith(9);
      expect(answer).toEqual({
        planilla: 'Planilla #9',
        origen: { lat: 4.71, lng: -74.07 },
        paradas: [
          {
            stop_id: 31,
            sequence: 1,
            lat: 4.72,
            lng: -74.08,
            customer: 'Tienda El Sol',
          },
        ],
        entregadas: 1,
        sin_ubicar: [
          { dispatch_note_id: 104, customer_address: 'Vereda El Hato' },
        ],
        next_step:
          'Repite con include_pdf=true si necesitas la ficha del PDF imprimible.',
      });
    });

    it('happy include_pdf: devuelve la ficha sin el binario', async () => {
      const getMapStops = jest.fn().mockResolvedValue(MAP);
      const generatePdf = jest
        .fn()
        .mockResolvedValue(Buffer.alloc(12345));
      const { tools } = buildTools({
        dispatchRoutesService: { getMapStops },
        routeFlowService: { generatePdf },
      });
      const tool = getTool(tools, 'get_route_map');
      const answer = JSON.parse(
        await tool.handler!({ route_id: 9, include_pdf: true }, CONTEXT),
      );

      expect(generatePdf).toHaveBeenCalledWith(9);
      expect(answer.pdf).toEqual({
        filename: 'planilla-9.pdf',
        bytes: 12345,
        nota: expect.stringContaining('Descárgalo'),
      });
      expect(JSON.stringify(answer)).not.toMatch(/%PDF/);
    });
  });

  describe('list_dispatch_notes (D-6)', () => {
    const NOTE_FULL = {
      id: 101,
      dispatch_number: 'REM-0101',
      status: 'draft',
      direction: 'outbound',
      subtype: 'sale',
      customer_name: 'Tienda El Sol',
      grand_total: '250000',
      order_id: 501,
      emission_date: '2026-01-09',
      agreed_delivery_date: '2026-01-10',
      customer_address: { address_line1: 'Calle 8 # 3-20' },
      dispatch_note_items: [
        { product_id: 5, product_name: 'Arroz 5kg', dispatched_quantity: '10' },
      ],
    };

    it('contrato: readOnly con permiso de lectura', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'list_dispatch_notes');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiredPermissions).toEqual([
        'store:dispatch_notes:read',
      ]);
      expect(tool.description).toMatch(/manage_dispatch_notes/);
    });

    it('happy detalle: remisión con líneas y dirección (snapshot)', async () => {
      const findOne = jest.fn().mockResolvedValue(NOTE_FULL);
      const { tools } = buildTools({
        dispatchNotesService: { findOne },
      });
      const tool = getTool(tools, 'list_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!({ dispatch_note_id: 101 }, CONTEXT),
      );

      expect(findOne).toHaveBeenCalledWith(101);
      expect(answer.remision.dispatch_number).toBe('REM-0101');
      expect(answer.remision.items).toEqual([
        { product: 'Arroz 5kg', quantity: 10 },
      ]);
      expect(answer.next_step).toMatch(/manage_dispatch_route/);
    });

    it('sad: status inválido no toca el servicio', async () => {
      const findAll = jest.fn();
      const { tools } = buildTools({
        dispatchNotesService: { findAll },
      });
      const tool = getTool(tools, 'list_dispatch_notes');
      const answer = JSON.parse(
        await tool.handler!({ status: 'volando' }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
      expect(findAll).not.toHaveBeenCalled();
    });
  });

  describe('manage_vehicles (D-7)', () => {
    const VEHICLE = {
      id: 4,
      plate: 'ABC123',
      brand: 'Chevrolet',
      model_name: 'NPR',
      capacity_kg: '3500',
      is_active: true,
    };

    it('contrato: confirmación + preview + permisos de flota', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_vehicles');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:dispatch_fleet:create',
        'store:dispatch_fleet:update',
        'store:dispatch_fleet:delete',
      ]);
    });

    it('happy create: preview con placa y handler delega (snapshot)', async () => {
      const create = jest.fn().mockResolvedValue(VEHICLE);
      const { tools } = buildTools({
        vehiclesService: { create },
      });
      const tool = getTool(tools, 'manage_vehicles');
      const args = {
        action: 'create',
        plate: 'ABC123',
        brand: 'Chevrolet',
        model_name: 'NPR',
        capacity_kg: 3500,
        primary_driver_id: 11,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Alta de vehículo — placa ABC123');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(create).toHaveBeenCalled();
      expect(answer).toEqual({
        resumen: 'Vehículo placa ABC123 dado de alta (#4).',
        vehicle_id: 4,
      });
    });

    it('happy update(is_active=false): retiro seguro con re-verificación', async () => {
      const update = jest.fn().mockResolvedValue({ ...VEHICLE });
      const findOne = jest.fn().mockResolvedValue(VEHICLE);
      const { tools } = buildTools({
        vehiclesService: { findOne, update },
      });
      const tool = getTool(tools, 'manage_vehicles');

      const preview = await tool.preview!(
        { action: 'update', vehicle_id: 4, is_active: false },
        CONTEXT as any,
      );
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Edición — Vehículo ABC123');

      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', vehicle_id: 4, is_active: false },
          CONTEXT,
        ),
      );
      expect(findOne).toHaveBeenCalledWith(4);
      expect(update).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ is_active: false }),
      );
      expect(answer.resumen).toMatch(/actualizado/);
    });
  });
});
