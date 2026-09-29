import { order_channel_enum, order_state_enum } from '@prisma/client';
import { SORTABLE_COLUMNS } from '../../../domains/store/orders/orders.service';
import { createOrdersTools, OrdersToolDeps } from './orders.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  ErrorCodes,
  VendixHttpException,
} from '../../../common/errors';

/**
 * T4 — Spec de contrato de la familia orders. Copia el patrón canónico
 * fijado en `products.tools.spec.ts`: (a) validación happy/sad sin tocar
 * deps en sad, (b) snapshot JSON exacto con `toEqual`, (c) forma
 * `{error, next_step}`, (d) permiso, (e) familia 100% `readOnly` — si se
 * agrega un write, el bloque de registro falla y obliga a extender la spec
 * con sus casos de confirmación + `preview`.
 *
 * Los mensajes de enum inválido se construyen desde los enums Prisma
 * generados y `SORTABLE_COLUMNS` del service dueño (T3): la spec pinnea el
 * formato exacto sin copiar la lista a mano.
 */
describe('orders.tools · contrato T4', () => {
  const STORE_ID = 7;

  const ORDER_STATES = Object.values(order_state_enum);
  const ORDER_CHANNELS = Object.values(order_channel_enum);

  function baseDeps() {
    return {
      ordersService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findOrderByIdForAgent: jest.fn(),
        findDispatchStatusForAgent: jest.fn(),
        create: jest.fn(),
        updateOrderItems: jest.fn(),
        getTimeline: jest.fn(),
      } as any,
      dispatchNotesService: {
        getByOrder: jest.fn(),
      } as any,
      sessionsService: {
        getCashSummary: jest.fn(),
        findOne: jest.fn(),
        findAll: jest.fn(),
        getActiveSession: jest.fn(),
        countOpenSessions: jest.fn(),
      } as any,
      orderFlowService: {
        payOrder: jest.fn(),
        shipOrder: jest.fn(),
        cancelOrder: jest.fn(),
        deliverOrder: jest.fn(),
        deliverOrderItem: jest.fn(),
        confirmDelivery: jest.fn(),
      } as any,
      refundFlowService: {
        previewRefund: jest.fn(),
        createRefund: jest.fn(),
      } as any,
      stockValidatorService: {
        findInsufficientLines: jest.fn(),
      } as any,
      ordersBulkService: {
        previewTransition: jest.fn(),
        bulkTransition: jest.fn(),
      } as any,
    } satisfies OrdersToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createOrdersTools(deps) };
  }

  function getHandler(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool.handler;
  }

  function getPreview(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool?.preview) throw new Error(`${name} sin preview`);
    return tool.preview;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID, user_id: 9 },
  ) => JSON.parse(await getHandler(tools, name)(args, context as any));

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID, user_id: 9 },
  ) => getPreview(tools, name)(args, context as any);

  const ORDER_ROW = {
    id: 301,
    order_number: 'ORD260800301',
    users: {
      first_name: 'Marcela',
      last_name: 'Ríos',
      email: 'marcela@example.com',
    },
    customer_id: 501,
    state: 'processing',
    channel: 'pos',
    delivery_type: 'delivery',
    grand_total: 59500,
    total_paid: 59500,
    remaining_balance: 0,
    dispatch_fulfillment: 'none',
    order_items: [{ id: 1 }, { id: 2 }],
    created_at: new Date('2026-08-30T15:00:00.000Z'),
  };

  const COMPACT_ORDER = {
    order_id: 301,
    numero: 'ORD260800301',
    cliente: 'Marcela Ríos',
    customer_id: 501,
    estado: 'processing',
    canal: 'pos',
    tipo_entrega: 'delivery',
    total: 59500,
    pagado: 59500,
    saldo_pendiente: 0,
    cumplimiento_despacho: 'none',
    items: 2,
    creada: '2026-08-30T15:00:00.000Z',
  };

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 15 tools del dominio orders', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'find_order',
        'list_orders',
        'get_order',
        'get_cash_session_status',
        'get_dispatch_status',
        'create_order',
        'manage_order_items',
        'pay_order',
        'ship_order',
        'cancel_order',
        'preview_refund',
        'refund_order',
        'deliver_order_items',
        'get_order_timeline',
        'bulk_transition_orders',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('orders');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool declara su permiso dueño', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(byName.get('find_order')!.requiredPermissions).toEqual([
        'store:orders:read',
      ]);
      expect(byName.get('list_orders')!.requiredPermissions).toEqual([
        'store:orders:read',
      ]);
      expect(byName.get('get_order')!.requiredPermissions).toEqual([
        'store:orders:read',
      ]);
      expect(
        byName.get('get_cash_session_status')!.requiredPermissions,
      ).toEqual(['store:cash_registers:read']);
      expect(byName.get('get_dispatch_status')!.requiredPermissions).toEqual([
        'store:dispatch_notes:read',
      ]);
      expect(byName.get('create_order')!.requiredPermissions).toEqual([
        'store:orders:create',
      ]);
      expect(byName.get('manage_order_items')!.requiredPermissions).toEqual([
        'store:orders:update',
      ]);
      expect(byName.get('pay_order')!.requiredPermissions).toEqual([
        'store:orders:order_flow:create',
      ]);
      expect(byName.get('ship_order')!.requiredPermissions).toEqual([
        'store:orders:order_flow:create',
      ]);
      expect(byName.get('cancel_order')!.requiredPermissions).toEqual([
        'store:orders:order_flow:create',
      ]);
      expect(byName.get('preview_refund')!.requiredPermissions).toEqual([
        'store:orders:order_flow:read',
      ]);
      expect(byName.get('refund_order')!.requiredPermissions).toEqual([
        'store:orders:order_flow:create',
      ]);
      expect(byName.get('deliver_order_items')!.requiredPermissions).toEqual([
        'store:orders:order_flow:create',
      ]);
      expect(byName.get('get_order_timeline')!.requiredPermissions).toEqual([
        'store:orders:read',
      ]);
      expect(
        byName.get('bulk_transition_orders')!.requiredPermissions,
      ).toEqual(['store:orders:bulk_update']);
    });

    it('reads readOnly y writes con confirmación+preview (cero aprobación ciega)', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const reads = [
        'find_order',
        'list_orders',
        'get_order',
        'get_cash_session_status',
        'get_dispatch_status',
        'preview_refund',
        'get_order_timeline',
      ];
      const writes = [
        'create_order',
        'manage_order_items',
        'pay_order',
        'ship_order',
        'cancel_order',
        'refund_order',
        'deliver_order_items',
        'bulk_transition_orders',
      ];
      for (const name of reads) {
        const tool = byName.get(name)!;
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
      }
      for (const name of writes) {
        const tool = byName.get(name)!;
        expect(tool.readOnly ?? false).toBe(false);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
      }
      for (const tool of tools) {
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums (los de órdenes salen del schema Prisma)', () => {
      const { tools } = buildTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(byName.get('find_order')!.parameters.required).toEqual(['query']);
      expect(byName.get('list_orders')!.parameters.required ?? []).toEqual([]);
      expect(byName.get('get_order')!.parameters.required).toEqual([
        'order_id',
      ]);
      expect(
        byName.get('get_cash_session_status')!.parameters.required ?? [],
      ).toEqual([]);
      expect(byName.get('get_dispatch_status')!.parameters.required).toEqual([
        'order_id',
      ]);
      expect(
        byName.get('find_order')!.parameters.properties.state.enum,
      ).toEqual(ORDER_STATES);
      expect(
        byName.get('list_orders')!.parameters.properties.channel.enum,
      ).toEqual(ORDER_CHANNELS);
      expect(
        byName.get('list_orders')!.parameters.properties.sort_by.enum,
      ).toEqual([...SORTABLE_COLUMNS]);
      expect(
        byName.get('get_cash_session_status')!.parameters.properties.scope
          .enum,
      ).toEqual(['me', 'store']);
      expect(byName.get('create_order')!.parameters.required).toEqual([
        'items',
      ]);
      expect(byName.get('manage_order_items')!.parameters.required).toEqual([
        'order_id',
        'items',
      ]);
      expect(byName.get('pay_order')!.parameters.required).toEqual([
        'order_id',
        'store_payment_method_id',
      ]);
      expect(
        byName.get('pay_order')!.parameters.properties.payment_type.enum,
      ).toEqual(['direct', 'online']);
      expect(byName.get('ship_order')!.parameters.required).toEqual([
        'order_id',
      ]);
      expect(byName.get('cancel_order')!.parameters.required).toEqual([
        'order_id',
        'reason',
      ]);
      expect(byName.get('preview_refund')!.parameters.required).toEqual([
        'order_id',
        'items',
      ]);
      expect(byName.get('refund_order')!.parameters.required).toEqual([
        'order_id',
        'items',
        'refund_method',
        'reason',
        'techo_preview',
      ]);
      expect(
        byName.get('refund_order')!.parameters.properties.refund_method.enum,
      ).toEqual(['original_payment', 'cash', 'bank_transfer', 'store_credit']);
      expect(byName.get('deliver_order_items')!.parameters.required).toEqual([
        'order_id',
        'action',
      ]);
      expect(
        byName.get('deliver_order_items')!.parameters.properties.action.enum,
      ).toEqual(['deliver', 'deliver_item', 'confirm_delivery']);
      expect(byName.get('get_order_timeline')!.parameters.required).toEqual([
        'order_id',
      ]);
      expect(byName.get('bulk_transition_orders')!.parameters.required).toEqual(
        ['order_ids', 'target_state'],
      );
      expect(
        byName.get('bulk_transition_orders')!.parameters.properties.target_state
          .enum,
      ).toEqual(['finished', 'shipped', 'delivered', 'cancelled']);
    });
  });

  // ─── find_order ───────────────────────────────────────────────────────
  describe('find_order', () => {
    it('(b) happy: snapshot exacto de coincidencia única + DTO sin casts', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findAll.mockResolvedValue({
        data: [ORDER_ROW],
        pagination: { total: 1 },
      });

      const answer = await run(tools, 'find_order', { query: 'ORD-301' });

      // El DTO se arma con el estado ya tipado: sin `as OrderQueryDto` (T3).
      expect(deps.ordersService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 5,
        search: 'ORD-301',
      });
      // Query no numérica: no hay rescate por id.
      expect(deps.ordersService.findOrderByIdForAgent).not.toHaveBeenCalled();
      expect(answer).toEqual({
        busqueda: 'ORD-301',
        encontradas: 1,
        total_coincidencias: 1,
        hay_mas: false,
        resolucion:
          'Coincidencia única: puedes usar su order_id directamente.',
        candidatas: [COMPACT_ORDER],
      });
    });

    it('(b) rescate numérico: "301" consulta el id aunque search no lo mire', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      });
      deps.ordersService.findOrderByIdForAgent.mockResolvedValue(ORDER_ROW);

      const answer = await run(tools, 'find_order', { query: '301' });

      expect(deps.ordersService.findOrderByIdForAgent).toHaveBeenCalledWith(
        301,
      );
      expect(answer).toEqual({
        busqueda: '301',
        encontradas: 1,
        total_coincidencias: 0,
        hay_mas: false,
        resolucion:
          'Coincidencia única: puedes usar su order_id directamente.',
        candidatas: [COMPACT_ORDER],
      });
    });

    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'find_order', { query: 'ORD-1' }, {});

      expect(answer).toEqual({
        error: 'Sin tienda en contexto: la búsqueda de órdenes está acotado por tienda.',
      });
      expect(deps.ordersService.findAll).not.toHaveBeenCalled();
    });

    it('(a) sad: query vacío → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'find_order', { query: '   ' });

      expect(answer).toEqual({
        error:
          'query vacío. Pásale el número de orden o el nombre del cliente.',
      });
      expect(deps.ordersService.findAll).not.toHaveBeenCalled();
    });

    it('(a) sad: estado inexistente → error con los valores válidos', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'find_order',
        { query: 'ORD-1', state: 'volando' },
      );

      expect(answer).toEqual({
        error: `state "volando" no existe. Valores válidos: ${ORDER_STATES.join(', ')}.`,
      });
      expect(deps.ordersService.findAll).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → error con la causa', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findAll.mockRejectedValue(new Error('caído'));

      const answer = await run(tools, 'find_order', { query: 'ORD-1' });

      expect(answer).toEqual({
        error: 'No se pudo buscar la orden: caído',
      });
    });
  });

  // ─── list_orders ──────────────────────────────────────────────────────
  describe('list_orders', () => {
    it('(b) happy: snapshot exacto de página + query mínima al service', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findAll.mockResolvedValue({
        data: [ORDER_ROW],
        pagination: { total: 1, totalPages: 1 },
      });

      const answer = await run(tools, 'list_orders', {});

      expect(deps.ordersService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
      expect(answer).toEqual({
        paginacion: {
          total_ordenes: 1,
          pagina: 1,
          por_pagina: 10,
          total_paginas: 1,
          hay_mas: false,
        },
        mostrando: 1,
        data: [COMPACT_ORDER],
      });
    });

    it('(a) date_from sin date_to se ignora con aviso, sin llaves de fecha', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0, totalPages: 1 },
      });

      const answer = await run(
        tools,
        'list_orders',
        { date_from: '2026-08-01' },
      );

      expect(deps.ordersService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
      expect(answer.aviso).toBe(
        'date_from sin date_to se ignora: el filtro de fechas exige ambos extremos.',
      );
      expect(answer.data).toEqual([]);
    });

    it.each([
      ['state', 'volando', ORDER_STATES],
      ['channel', 'telepatia', ORDER_CHANNELS],
      ['sort_by', 'color', SORTABLE_COLUMNS],
    ])(
      '(a) sad: %s inválido → error con los valores válidos',
      async (field, value, allowed) => {
        const { deps, tools } = buildTools();

        const answer = await run(tools, 'list_orders', { [field]: value });

        expect(answer).toEqual({
          error: `${field} "${value}" no existe. Valores válidos: ${[...allowed].join(', ')}.`,
        });
        expect(deps.ordersService.findAll).not.toHaveBeenCalled();
      },
    );

    it('(a) sad: fecha fuera de formato → error exacto', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'list_orders',
        { date_from: '30-08-2026', date_to: '2026-08-31' },
      );

      expect(answer).toEqual({
        error:
          'Las fechas deben venir en formato YYYY-MM-DD. Recibido: date_from="30-08-2026", date_to="2026-08-31".',
      });
      expect(deps.ordersService.findAll).not.toHaveBeenCalled();
    });

    it('(a) sad: rango invertido → error exacto', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'list_orders',
        { date_from: '2026-09-01', date_to: '2026-08-01' },
      );

      expect(answer).toEqual({
        error:
          'El rango está invertido: date_from (2026-09-01) es posterior a date_to (2026-08-01).',
      });
      expect(deps.ordersService.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── get_order ────────────────────────────────────────────────────────
  describe('get_order', () => {
    const FULL_ORDER = {
      id: 301,
      order_number: 'ORD260800301',
      state: 'processing',
      channel: 'pos',
      delivery_type: 'delivery',
      dispatch_fulfillment: 'partial',
      currency: 'COP',
      created_at: new Date('2026-08-30T15:00:00.000Z'),
      placed_at: new Date('2026-08-30T15:05:00.000Z'),
      completed_at: null,
      notes: 'Timbrar 2 veces',
      internal_notes: null,
      customer_id: 501,
      users: {
        email: 'marcela@example.com',
        phone: '3001234567',
        first_name: 'Marcela',
        last_name: 'Ríos',
      },
      subtotal_amount: 50000,
      discount_amount: 0,
      tax_amount: 9500,
      shipping_cost: 0,
      tip_amount: 0,
      grand_total: 59500,
      total_paid: 59500,
      remaining_balance: 0,
      order_items: [
        {
          product_id: 101,
          product_name: 'Coca Cola 1L',
          variant_attributes: null,
          variant_sku: null,
          products: { sku: 'COCA-1L' },
          quantity: 10,
          unit_price: 5000,
          total_price: 50000,
        },
      ],
      payments: [
        {
          id: 77,
          store_payment_method: {
            system_payment_method: { name: 'Efectivo' },
          },
          amount: 59500,
          state: 'completed',
          created_at: new Date('2026-08-30T15:06:00.000Z'),
        },
      ],
      shipping_method: { name: 'Domicilio moto', type: 'delivery' },
      shipping_rate: { shipping_zone: { display_name: 'Norte' } },
      addresses_orders_shipping_address_idToaddresses: {
        address_line1: 'Calle 1 # 2-3',
        city: 'Bogotá',
        state: 'Cundinamarca',
        country: 'CO',
      },
      invoices: [],
    };

    it('(b) happy: snapshot exacto del detalle', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(FULL_ORDER);

      const answer = await run(tools, 'get_order', { order_id: 301 });

      expect(deps.ordersService.findOne).toHaveBeenCalledWith(301);
      expect(answer).toEqual({
        orden: {
          order_id: 301,
          numero: 'ORD260800301',
          estado: 'processing',
          canal: 'pos',
          tipo_entrega: 'delivery',
          cumplimiento_despacho: 'partial',
          moneda: 'COP',
          creada: '2026-08-30T15:00:00.000Z',
          confirmada: '2026-08-30T15:05:00.000Z',
          completada: null,
          notas_cliente: 'Timbrar 2 veces',
          notas_internas: null,
        },
        cliente: {
          customer_id: 501,
          nombre: 'Marcela Ríos',
          email: 'marcela@example.com',
          telefono: '3001234567',
        },
        totales: {
          subtotal: 50000,
          descuento: 0,
          impuestos: 9500,
          envio: 0,
          propina: 0,
          total: 59500,
          pagado: 59500,
          saldo_pendiente: 0,
        },
        items: [
          {
            product_id: 101,
            producto: 'Coca Cola 1L',
            variante: null,
            sku: 'COCA-1L',
            cantidad: 10,
            precio_unitario: 5000,
            total_linea: 50000,
          },
        ],
        pagos: [
          {
            payment_id: 77,
            metodo: 'Efectivo',
            monto: 59500,
            estado: 'completed',
            fecha: '2026-08-30T15:06:00.000Z',
          },
        ],
        envio: {
          metodo: 'Domicilio moto',
          tipo: 'delivery',
          zona: 'Norte',
          direccion: {
            linea: 'Calle 1 # 2-3',
            ciudad: 'Bogotá',
            departamento: 'Cundinamarca',
            pais: 'CO',
          },
        },
        factura_electronica: null,
      });
    });

    it('(a) sad: order_id inválido → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_order', { order_id: 0 });

      expect(answer).toEqual({
        error:
          'order_id inválido: "0". Usa find_order para obtener uno válido.',
      });
      expect(deps.ordersService.findOne).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → error con la causa', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockRejectedValue(new Error('boom'));

      const answer = await run(tools, 'get_order', { order_id: 301 });

      expect(answer).toEqual({
        error:
          'No se encontró la orden 301 en esta tienda, o no se pudo leer: boom',
      });
    });
  });

  // ─── get_cash_session_status ──────────────────────────────────────────
  describe('get_cash_session_status', () => {
    const SESSION = {
      id: 55,
      register: { name: 'Caja 1' },
      cash_register_id: 3,
      status: 'open',
      opened_by_user: { first_name: 'Ana', last_name: 'Ríos' },
      opened_at: new Date('2026-09-01T08:00:00.000Z'),
      closed_at: null,
      opening_amount: 200000,
    };

    const SUMMARY = {
      opening: 200000,
      sales_total: 59500,
      sales_count: 2,
      sales_by_method: [
        { method: 'cash', count: 1, total: 50000 },
        { method: 'card', count: 1, total: 9500 },
      ],
      cash_sales: 50000,
      cash_in: 0,
      cash_out: 5000,
      cash_refunds: 0,
      expected_cash_total: 245000,
      non_cash_total: 9500,
    };

    const EXPECTED_ARQUEO = {
      base_apertura: 200000,
      ventas_totales: 59500,
      ventas_cantidad: 2,
      ventas_por_metodo: [
        { metodo: 'cash', cantidad: 1, total: 50000 },
        { metodo: 'card', cantidad: 1, total: 9500 },
      ],
      ventas_en_efectivo: 50000,
      entradas_efectivo: 0,
      salidas_efectivo: 5000,
      devoluciones_efectivo: 0,
      efectivo_esperado: 245000,
      no_efectivo: 9500,
    };

    it('(b) happy: snapshot exacto del turno del usuario actual', async () => {
      const { deps, tools } = buildTools();
      deps.sessionsService.getActiveSession.mockResolvedValue(SESSION);
      deps.sessionsService.getCashSummary.mockResolvedValue(SUMMARY);

      const answer = await run(tools, 'get_cash_session_status', {});

      expect(deps.sessionsService.getActiveSession).toHaveBeenCalledWith(9);
      expect(deps.sessionsService.getCashSummary).toHaveBeenCalledWith(55);
      expect(answer).toEqual({
        alcance: 'usuario actual',
        hay_caja_abierta: true,
        sesion: {
          session_id: 55,
          caja: 'Caja 1',
          cash_register_id: 3,
          estado: 'open',
          abierta_por: 'Ana Ríos',
          abierta_en: '2026-09-01T08:00:00.000Z',
          cerrada_en: null,
          base_apertura: 200000,
        },
        arqueo: EXPECTED_ARQUEO,
      });
    });

    it('(c) sin turno propio → nota + cajas ajenas con sugerencia de scope', async () => {
      const { deps, tools } = buildTools();
      deps.sessionsService.getActiveSession.mockResolvedValue(null);
      deps.sessionsService.countOpenSessions.mockResolvedValue({
        count: 1,
        registers: ['Caja 2'],
      });

      const answer = await run(tools, 'get_cash_session_status', {});

      expect(answer).toEqual({
        alcance: 'usuario actual',
        hay_caja_abierta: false,
        nota: 'El usuario no tiene ningún turno de caja abierto a su nombre.',
        otras_cajas_abiertas_en_tienda: 1,
        cajas: ['Caja 2'],
        sugerencia:
          'Otro operador sí tiene caja abierta. Usa scope="store" si la pregunta era por la tienda y no por el usuario.',
      });
      expect(deps.sessionsService.getCashSummary).not.toHaveBeenCalled();
    });

    it('(b) scope store con una sola caja → arqueo inline', async () => {
      const { deps, tools } = buildTools();
      deps.sessionsService.findAll.mockResolvedValue({
        data: [SESSION],
        meta: { total: 1 },
      });
      deps.sessionsService.getCashSummary.mockResolvedValue(SUMMARY);

      const answer = await run(
        tools,
        'get_cash_session_status',
        { scope: 'store' },
      );

      expect(deps.sessionsService.findAll).toHaveBeenCalledWith({
        status: 'open',
        page: 1,
        limit: 10,
      });
      expect(answer).toEqual({
        alcance: 'tienda',
        hay_caja_abierta: true,
        sesiones_abiertas: 1,
        mostrando: 1,
        sesiones: [
          {
            session_id: 55,
            caja: 'Caja 1',
            cash_register_id: 3,
            estado: 'open',
            abierta_por: 'Ana Ríos',
            abierta_en: '2026-09-01T08:00:00.000Z',
            cerrada_en: null,
            base_apertura: 200000,
          },
        ],
        arqueo: EXPECTED_ARQUEO,
      });
    });

    it('(a) sad: session_id inválido → error sin leer la sesión', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_cash_session_status',
        { session_id: 'x' },
      );

      expect(answer).toEqual({ error: 'session_id inválido: "x".' });
      expect(deps.sessionsService.findOne).not.toHaveBeenCalled();
      expect(deps.sessionsService.getCashSummary).not.toHaveBeenCalled();
    });
  });

  // ─── get_dispatch_status ──────────────────────────────────────────────
  describe('get_dispatch_status', () => {
    const DISPATCH_ORDER = {
      id: 301,
      order_number: 'ORD260800301',
      state: 'processing',
      delivery_type: 'delivery',
      dispatch_fulfillment: 'partial',
      created_at: new Date('2026-08-30T15:00:00.000Z'),
      order_items: [
        { id: 1, product_name: 'Coca Cola 1L', quantity: 5 },
        { id: 2, product_name: 'Pan', quantity: 2 },
      ],
    };

    const NOTE = {
      id: 11,
      dispatch_number: 'REM-001',
      status: 'confirmed',
      emission_date: new Date('2026-08-31T10:00:00.000Z'),
      delivered_at: null,
      actual_delivery_date: null,
      dispatch_note_items: [
        { sales_order_item_id: 1, dispatched_quantity: 3 },
        { sales_order_item_id: 2, dispatched_quantity: 2 },
        { sales_order_item_id: null, dispatched_quantity: 99 },
      ],
    };

    it('(b) happy: snapshot exacto con renglón suelto ignorado', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findDispatchStatusForAgent.mockResolvedValue(
        DISPATCH_ORDER,
      );
      deps.dispatchNotesService.getByOrder.mockResolvedValue([NOTE]);

      const answer = await run(tools, 'get_dispatch_status', { order_id: 301 });

      expect(deps.dispatchNotesService.getByOrder).toHaveBeenCalledWith(301);
      expect(answer).toEqual({
        orden: {
          order_id: 301,
          numero: 'ORD260800301',
          estado: 'processing',
          tipo_entrega: 'delivery',
          creada: '2026-08-30T15:00:00.000Z',
        },
        cumplimiento: 'partial',
        cumplimiento_nota:
          'none = sin remisionar, partial = remisionada a medias, full = totalmente remisionada.',
        unidades: { pedidas: 7, remisionadas: 5, pendientes: 2 },
        remisiones: [
          {
            dispatch_note_id: 11,
            numero: 'REM-001',
            estado: 'confirmed',
            emitida: '2026-08-31T10:00:00.000Z',
            entregada: null,
            renglones: 3,
          },
        ],
        remisiones_nota:
          'Las remisiones anuladas quedan excluidas: no consumen unidades pendientes.',
        renglones_pendientes: [
          {
            producto: 'Coca Cola 1L',
            pedidas: 5,
            remisionadas: 3,
            pendientes: 2,
          },
        ],
      });
    });

    it('(a) sad: order_id inválido → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_dispatch_status',
        { order_id: -1 },
      );

      expect(answer).toEqual({
        error: 'order_id inválido: "-1". Usa find_order para obtener uno válido.',
      });
      expect(deps.ordersService.findDispatchStatusForAgent).not.toHaveBeenCalled();
      expect(deps.dispatchNotesService.getByOrder).not.toHaveBeenCalled();
    });

    it('(c) orden inexistente → error sin pedir remisiones', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findDispatchStatusForAgent.mockResolvedValue(null);

      const answer = await run(
        tools,
        'get_dispatch_status',
        { order_id: 404 },
      );

      expect(answer).toEqual({
        error: 'No existe la orden 404 en esta tienda.',
      });
      expect(deps.dispatchNotesService.getByOrder).not.toHaveBeenCalled();
    });
  });

  // ─── O-19 create_order ──────────────────────────────────────────────────
  describe('create_order', () => {
    const ITEMS = [
      {
        product_id: 11,
        product_name: 'Coca Cola 1L',
        quantity: 2,
        unit_price: 5000,
      },
    ];

    it('(b) happy: crea con stock reservado + total calculado', async () => {
      const { deps, tools } = buildTools();
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue([]);
      deps.ordersService.create.mockResolvedValue({
        id: 301,
        order_number: 'ORD260800301',
        state: 'created',
        grand_total: 10000,
      });

      const answer = await run(tools, 'create_order', {
        customer_id: 501,
        items: ITEMS,
      });

      expect(answer).toEqual({
        orden_creada: {
          order_id: 301,
          numero: 'ORD260800301',
          estado: 'created',
          total: 10000,
        },
        next_step:
          'La orden quedó creada con stock reservado. Usa pay_order para cobrarla.',
      });
      expect(
        deps.stockValidatorService.findInsufficientLines,
      ).toHaveBeenCalledWith(
        [
          {
            product_id: 11,
            product_variant_id: null,
            quantity: 2,
            product_name: 'Coca Cola 1L',
          },
        ],
        { kind: 'product' },
      );
      const [dto, user] = deps.ordersService.create.mock.calls[0];
      expect(dto.subtotal).toBe(10000);
      expect(dto.items[0].total_price).toBe(10000);
      expect(user).toEqual({ id: 9 });
    });

    it('(e) preview ok: sujeto humano + dominio de refresh', async () => {
      const { deps, tools } = buildTools();
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue([]);

      const result = await preview(tools, 'create_order', { items: ITEMS });

      expect(result.status).toBe('ok');
      expect(result.target).toBe('Nueva orden: 2× Coca Cola 1L');
      expect(result.domain).toBe('orders');
      expect(result.changes).toEqual([
        {
          field: 'items',
          label: 'Renglones',
          from: null,
          to: '2× Coca Cola 1L',
        },
        { field: 'subtotal', label: 'Subtotal', from: null, to: 10000 },
        {
          field: 'cliente',
          label: 'Cliente',
          from: null,
          to: 'Mostrador (sin cliente)',
        },
      ]);
    });

    it('(a) sad: sin stock → {error, next_step} ES con líneas insuficientes', async () => {
      const { deps, tools } = buildTools();
      const short = [
        {
          product_id: 11,
          product_variant_id: null,
          product_name: 'Coca Cola 1L',
          kind: 'product',
          requested: 2,
          available: 1,
        },
      ];
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue(short);

      const answer = await run(tools, 'create_order', { items: ITEMS });

      expect(answer.error).toContain('Coca Cola 1L: pide 2, hay 1 disponibles');
      expect(answer.next_step).toContain('check_stock_availability');
      expect(deps.ordersService.create).not.toHaveBeenCalled();
    });

    it('(c) carrera: el service rechaza por stock y el handler re-cotiza líneas', async () => {
      const { deps, tools } = buildTools();
      const short = [
        {
          product_id: 11,
          product_variant_id: null,
          product_name: 'Coca Cola 1L',
          kind: 'product',
          requested: 2,
          available: 0,
        },
      ];
      deps.stockValidatorService.findInsufficientLines
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(short);
      deps.ordersService.create.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
          'Stock insuficiente',
          { items: short },
        ),
      );

      const answer = await run(tools, 'create_order', { items: ITEMS });

      expect(answer.error).toContain('Coca Cola 1L: pide 2, hay 0 disponibles');
      expect(answer.next_step).toContain('check_stock_availability');
      expect(deps.ordersService.create).toHaveBeenCalledTimes(1);
    });

    it('(a) sad: preview sin stock no acuña (status error)', async () => {
      const { deps, tools } = buildTools();
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue([
        {
          product_id: 11,
          product_variant_id: null,
          product_name: 'Coca Cola 1L',
          kind: 'product',
          requested: 5,
          available: 0,
        },
      ]);

      const result = await preview(tools, 'create_order', {
        items: [{ ...ITEMS[0], quantity: 5 }],
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('no permite sobreventa');
      expect(deps.ordersService.create).not.toHaveBeenCalled();
    });

    it('(a) sad: renglón sin nombre → error sin tocar services', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'create_order', {
        items: [{ quantity: 1, unit_price: 100 }],
      });

      expect(answer.error).toContain('falta product_name');
      expect(answer.next_step).toBeDefined();
      expect(
        deps.stockValidatorService.findInsufficientLines,
      ).not.toHaveBeenCalled();
      expect(deps.ordersService.create).not.toHaveBeenCalled();
    });
  });

  // ─── O-20 manage_order_items ────────────────────────────────────────────
  describe('manage_order_items', () => {
    const EDITABLE = {
      ...ORDER_ROW,
      state: 'created',
      order_items: [{ quantity: 1, product_name: 'Pan viejo' }],
    };

    it('(b) happy: reemplaza la lista y acredita la reserva propia', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(EDITABLE);
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue([]);
      deps.ordersService.updateOrderItems.mockResolvedValue({
        id: 301,
        order_number: 'ORD260800301',
        state: 'created',
        grand_total: 5000,
      });

      const answer = await run(tools, 'manage_order_items', {
        order_id: 301,
        items: [
          { product_id: 11, product_name: 'Coca Cola 1L', quantity: 1, unit_price: 5000 },
        ],
      });

      expect(answer.orden_actualizada).toEqual({
        order_id: 301,
        numero: 'ORD260800301',
        estado: 'created',
        total: 5000,
      });
      expect(
        deps.stockValidatorService.findInsufficientLines,
      ).toHaveBeenCalledWith(expect.anything(), {
        kind: 'product',
        orderId: 301,
      });
    });

    it('(e) preview ok: muestra de→a con el número de orden', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(EDITABLE);
      deps.stockValidatorService.findInsufficientLines.mockResolvedValue([]);

      const result = await preview(tools, 'manage_order_items', {
        order_id: 301,
        items: [
          { product_name: 'Coca Cola 1L', quantity: 1, unit_price: 5000 },
        ],
      });

      expect(result.status).toBe('ok');
      expect(result.target).toContain('ORD260800301');
      expect(result.target).toContain('Marcela Ríos');
      expect(result.changes[0]).toEqual({
        field: 'items',
        label: 'Renglones (la lista se reemplaza completa)',
        from: '1× Pan viejo',
        to: '1× Coca Cola 1L',
      });
    });

    it('(a) sad: orden fuera de created/draft → error', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'finished',
      });

      const result = await preview(tools, 'manage_order_items', {
        order_id: 301,
        items: [{ product_name: 'X', quantity: 1, unit_price: 1 }],
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain("'finished'");
      expect(deps.ordersService.updateOrderItems).not.toHaveBeenCalled();
    });
  });

  // ─── O-21 pay_order ─────────────────────────────────────────────────────
  describe('pay_order', () => {
    const PENDING = {
      ...ORDER_ROW,
      state: 'pending_payment',
      remaining_balance: 59500,
    };

    it('(b) happy: cobra y relee totales autoritativos', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne
        .mockResolvedValueOnce(PENDING)
        .mockResolvedValueOnce({ ...PENDING, state: 'processing', remaining_balance: 0 });
      deps.orderFlowService.payOrder.mockResolvedValue({});

      const answer = await run(tools, 'pay_order', {
        order_id: 301,
        store_payment_method_id: 4,
      });

      expect(answer.cobro).toEqual({
        order_id: 301,
        numero: 'ORD260800301',
        estado: 'processing',
        total: 59500,
        pagado: 59500,
        saldo_pendiente: 0,
      });
      expect(deps.orderFlowService.payOrder).toHaveBeenCalledWith(
        301,
        expect.objectContaining({
          store_payment_method_id: 4,
          payment_type: 'direct',
        }),
      );
    });

    it('(e) preview warning sin turno de caja, ok con turno', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(PENDING);
      deps.sessionsService.getActiveSession.mockResolvedValue(null);

      const without = await preview(tools, 'pay_order', {
        order_id: 301,
        store_payment_method_id: 4,
      });
      expect(without.status).toBe('warning');
      expect(without.target).toContain('Cobrar orden ORD260800301');
      expect(without.target).toContain('Marcela Ríos');

      deps.sessionsService.getActiveSession.mockResolvedValue({ id: 1 });
      const withSession = await preview(tools, 'pay_order', {
        order_id: 301,
        store_payment_method_id: 4,
      });
      expect(withSession.status).toBe('ok');
    });

    it('(a) sad: orden terminada → error sin cobrar', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'finished',
      });

      const result = await preview(tools, 'pay_order', {
        order_id: 301,
        store_payment_method_id: 4,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain("'finished'");
      expect(deps.orderFlowService.payOrder).not.toHaveBeenCalled();
    });

    it('(c) el cobro se mueve de estado entre preview y apply → error', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'cancelled',
      });

      const answer = await run(tools, 'pay_order', {
        order_id: 301,
        store_payment_method_id: 4,
      });

      expect(answer.error).toContain("'cancelled'");
      expect(deps.orderFlowService.payOrder).not.toHaveBeenCalled();
    });
  });

  // ─── O-22 ship_order ────────────────────────────────────────────────────
  describe('ship_order', () => {
    const PROCESSING = {
      ...ORDER_ROW,
      state: 'processing',
      delivery_type: 'delivery',
      shipping_method_id: 3,
    };

    it('(b) happy: despacha desde processing', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne
        .mockResolvedValueOnce(PROCESSING)
        .mockResolvedValueOnce({ ...PROCESSING, state: 'shipped' });
      deps.orderFlowService.shipOrder.mockResolvedValue({});

      const answer = await run(tools, 'ship_order', {
        order_id: 301,
        tracking_number: 'GUIA-1',
      });

      expect(answer.despacho).toEqual({
        order_id: 301,
        numero: 'ORD260800301',
        estado: 'shipped',
      });
      expect(answer.nota).toContain('reservas de stock se consumieron');
      expect(deps.orderFlowService.shipOrder).toHaveBeenCalledWith(
        301,
        expect.objectContaining({ tracking_number: 'GUIA-1' }),
      );
    });

    it('(e) preview advierte si falta método de envío a domicilio', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...PROCESSING,
        shipping_method_id: null,
      });

      const result = await preview(tools, 'ship_order', { order_id: 301 });

      expect(result.status).toBe('warning');
      expect(result.message).toContain('shipping_method_id');
    });

    it('(a) sad: solo se despacha desde processing', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'created',
      });

      const result = await preview(tools, 'ship_order', { order_id: 301 });

      expect(result.status).toBe('error');
      expect(result.message).toContain("'created'");
      expect(deps.orderFlowService.shipOrder).not.toHaveBeenCalled();
    });
  });

  // ─── O-24 cancel_order ──────────────────────────────────────────────────
  describe('cancel_order', () => {
    it('(b) happy: cancela y libera reservas', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'processing',
        total_paid: 0,
      });
      deps.orderFlowService.cancelOrder.mockResolvedValue({});

      const answer = await run(tools, 'cancel_order', {
        order_id: 301,
        reason: 'El cliente desistió',
      });

      expect(answer.cancelacion).toEqual({
        order_id: 301,
        estado: 'cancelled',
      });
      expect(answer.nota).toContain('disponible se restauró');
      expect(deps.orderFlowService.cancelOrder).toHaveBeenCalledWith(
        301,
        expect.objectContaining({ reason: 'El cliente desistió' }),
      );
    });

    it('(e) preview warning cuando ya hay pagos', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'processing',
        total_paid: 59500,
      });

      const result = await preview(tools, 'cancel_order', {
        order_id: 301,
        reason: 'Duplicada',
      });

      expect(result.status).toBe('warning');
      expect(result.target).toContain('Cancelar orden ORD260800301');
      expect(result.changes).toContainEqual({
        field: 'reservas',
        label: 'Reservas de stock',
        from: 'retenidas',
        to: 'liberadas (disponible restaurado, físico intacto)',
      });
    });

    it('(a) sad: motivo corto → error de validación', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'cancel_order', {
        order_id: 301,
        reason: 'no',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('validación');
      expect(deps.orderFlowService.cancelOrder).not.toHaveBeenCalled();
    });

    it('(a) sad: ya cancelada → error', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...ORDER_ROW,
        state: 'cancelled',
      });

      const answer = await run(tools, 'cancel_order', {
        order_id: 301,
        reason: 'Otra vez',
      });

      expect(answer.error).toContain("'cancelled'");
      expect(deps.orderFlowService.cancelOrder).not.toHaveBeenCalled();
    });
  });

  // ─── O-25 preview_refund ────────────────────────────────────────────────
  describe('preview_refund', () => {
    const CALC = {
      total_refund: 10000,
      max_refundable: 59500,
      already_refunded: 0,
      is_full_refund: false,
      items: [
        {
          order_item_id: 1,
          product_name: 'Coca Cola 1L',
          quantity: 1,
          refund_amount: 10000,
          inventory_action: 'restock',
        },
      ],
    };
    const FINISHED = {
      ...ORDER_ROW,
      state: 'finished',
      customer_id: 501,
      payments: [{ state: 'succeeded' }],
    };

    it('(b) happy: snapshot de cobertura + métodos + techo', async () => {
      const { deps, tools } = buildTools();
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);
      deps.ordersService.findOne.mockResolvedValue(FINISHED);

      const answer = await run(tools, 'preview_refund', {
        order_id: 301,
        items: [{ order_item_id: 1, quantity: 1 }],
      });

      expect(answer.orden).toEqual({
        order_id: 301,
        numero: 'ORD260800301',
        estado: 'finished',
        cliente: 'Marcela Ríos',
        total: 59500,
        pagado: 59500,
      });
      expect(answer.cobertura).toEqual({
        total_reembolso: 10000,
        techo_maximo: 59500,
        ya_reembolsado: 0,
        es_total: false,
        por_renglon: [
          {
            order_item_id: 1,
            producto: 'Coca Cola 1L',
            cantidad: 1,
            monto_reembolso: 10000,
            accion_inventario: 'restock',
          },
        ],
      });
      expect(answer.techo_preview).toBe(59500);
      expect(answer.metodos).toEqual([
        {
          value: 'original_payment',
          label: 'Pago original',
          available: true,
        },
        { value: 'cash', label: 'Efectivo', available: true },
        { value: 'bank_transfer', label: 'Transferencia', available: true },
        {
          value: 'store_credit',
          label: 'Billetera del cliente',
          available: true,
        },
      ]);
      expect(answer.next_step).toContain('techo_preview');
    });

    it('(b) invitado sin pagos: original_payment y store_credit no disponibles', async () => {
      const { deps, tools } = buildTools();
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);
      deps.ordersService.findOne.mockResolvedValue({
        ...FINISHED,
        customer_id: null,
        users: null,
        payments: [],
      });

      const answer = await run(tools, 'preview_refund', {
        order_id: 301,
        items: [{ order_item_id: 1, quantity: 1 }],
      });

      const byValue = new Map<string, any>(
        answer.metodos.map((option: any) => [option.value, option]),
      );
      expect(byValue.get('original_payment').available).toBe(false);
      expect(byValue.get('store_credit').available).toBe(false);
      expect(byValue.get('cash').available).toBe(true);
      expect(answer.orden.cliente).toBe('Invitado (sin cliente registrado)');
    });

    it('(a) sad: order_id inválido → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'preview_refund', {
        order_id: 0,
        items: [{ order_item_id: 1, quantity: 1 }],
      });

      expect(answer.error).toContain('order_id inválido');
      expect(deps.refundFlowService.previewRefund).not.toHaveBeenCalled();
      expect(deps.ordersService.findOne).not.toHaveBeenCalled();
    });

    it('(c) estado no reembolsable → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.refundFlowService.previewRefund.mockRejectedValue(
        new Error("Cannot refund order in state 'processing'"),
      );
      deps.ordersService.findOne.mockResolvedValue(FINISHED);

      const answer = await run(tools, 'preview_refund', {
        order_id: 301,
        items: [{ order_item_id: 1, quantity: 1 }],
      });

      expect(answer.error).toContain("'processing'");
      expect(answer.next_step).toContain('delivered/finished');
    });
  });

  // ─── O-26 refund_order ─────────────────────────────────────────────────
  describe('refund_order', () => {
    const CALC = {
      total_refund: 10000,
      max_refundable: 59500,
      already_refunded: 0,
      is_full_refund: false,
      items: [
        {
          order_item_id: 1,
          product_name: 'Coca Cola 1L',
          quantity: 1,
          refund_amount: 10000,
          inventory_action: 'restock',
        },
      ],
    };
    const FINISHED = {
      ...ORDER_ROW,
      state: 'finished',
      customer_id: 501,
      payments: [{ state: 'succeeded' }],
    };
    const ARGS = {
      order_id: 301,
      items: [{ order_item_id: 1, quantity: 1, inventory_action: 'restock' }],
      refund_method: 'cash',
      reason: 'Producto vencido',
      techo_preview: 59500,
    };

    it('(b) happy: reembolsa con techo verificado', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(FINISHED);
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);
      deps.refundFlowService.createRefund.mockResolvedValue({
        id: 9,
        total_refund: 10000,
        state: 'completed',
      });

      const answer = await run(tools, 'refund_order', ARGS);

      expect(answer.reembolso).toEqual({
        refund_id: 9,
        order_id: 301,
        monto: 10000,
        estado: 'completed',
        metodo: 'cash',
      });
      expect(deps.refundFlowService.createRefund).toHaveBeenCalledWith(
        301,
        expect.objectContaining({ refund_method: 'cash' }),
      );
    });

    it('(e) preview cita cobertura y método (lo que porta el AI_AGENT_005)', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(FINISHED);
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);

      const result = await preview(tools, 'refund_order', ARGS);

      expect(result.status).toBe('ok');
      expect(result.target).toContain('ORD260800301');
      expect(result.target).toContain('Marcela Ríos');
      expect(result.target).toContain('cash');
      expect(result.changes).toContainEqual({
        field: 'cobertura',
        label: 'Cobertura (techo / ya reembolsado)',
        from: null,
        to: 'techo 59500, ya reembolsado 0',
      });
      expect(result.changes).toContainEqual({
        field: 'metodo',
        label: 'Método',
        from: null,
        to: 'cash',
      });
      expect(deps.refundFlowService.createRefund).not.toHaveBeenCalled();
    });

    it('(a) sad: sin techo_preview → exige preview_refund primero', async () => {
      const { deps, tools } = buildTools();
      const { techo_preview: _dropped, ...withoutCeiling } = ARGS;

      const result = await preview(tools, 'refund_order', withoutCeiling);

      expect(result.status).toBe('error');
      expect(result.message).toContain('preview_refund primero');
      expect(deps.refundFlowService.createRefund).not.toHaveBeenCalled();
    });

    it('(a) sad: techo movido → pide repetir el preview', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(FINISHED);
      deps.refundFlowService.previewRefund.mockResolvedValue({
        ...CALC,
        max_refundable: 49500,
      });

      const answer = await run(tools, 'refund_order', ARGS);

      expect(answer.error).toContain('El techo se movió');
      expect(answer.next_step).toContain('preview_refund');
      expect(deps.refundFlowService.createRefund).not.toHaveBeenCalled();
    });

    it('(a) sad: método no disponible → error', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...FINISHED,
        customer_id: null,
        users: null,
      });
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);

      const result = await preview(tools, 'refund_order', {
        ...ARGS,
        refund_method: 'store_credit',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('store_credit');
      expect(deps.refundFlowService.createRefund).not.toHaveBeenCalled();
    });

    it('(c) createRefund lanza → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(FINISHED);
      deps.refundFlowService.previewRefund.mockResolvedValue(CALC);
      deps.refundFlowService.createRefund.mockRejectedValue(
        new Error('processor caído'),
      );

      const answer = await run(tools, 'refund_order', ARGS);

      expect(answer.error).toContain('processor caído');
      expect(answer.next_step).toContain('preview_refund');
    });
  });

  // ─── O-23 deliver_order_items ─────────────────────────────────────────
  describe('deliver_order_items', () => {
    const SHIPPED = {
      ...ORDER_ROW,
      state: 'shipped',
      order_items: [
        { id: 11, product_name: 'Coca Cola 1L', delivered_at: null },
        {
          id: 12,
          product_name: 'Pan tajado',
          delivered_at: '2026-08-30T16:00:00.000Z',
        },
      ],
    };

    it('(b) happy: deliver shipped→delivered con sujeto humano', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(SHIPPED);
      deps.orderFlowService.deliverOrder.mockResolvedValue({
        ...SHIPPED,
        state: 'delivered',
      });

      const answer = await run(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'deliver',
        delivered_to: 'Marcela Ríos',
      });

      expect(answer).toEqual({
        entrega: {
          order_id: 301,
          numero: 'ORD260800301',
          estado: 'delivered',
        },
        nota: expect.stringContaining('confirm_delivery'),
      });
      expect(deps.orderFlowService.deliverOrder).toHaveBeenCalledWith(
        301,
        expect.objectContaining({ delivered_to: 'Marcela Ríos' }),
      );
    });

    it('(e) preview deliver_item nombra el producto, no el id', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(SHIPPED);

      const result = await preview(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'deliver_item',
        order_item_id: 11,
      });

      expect(result.status).toBe('ok');
      expect(result.target).toContain('Coca Cola 1L');
      expect(result.target).toContain('ORD260800301');
      expect(result.domain).toBe('orders');
      expect(deps.orderFlowService.deliverOrderItem).not.toHaveBeenCalled();
    });

    it('(b) happy: confirm_delivery cierra delivered', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...SHIPPED,
        state: 'delivered',
      });
      deps.orderFlowService.confirmDelivery.mockResolvedValue({
        ...SHIPPED,
        state: 'finished',
      });

      const answer = await run(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'confirm_delivery',
      });

      expect(answer.entrega.estado).toBe('finished');
      expect(deps.orderFlowService.confirmDelivery).toHaveBeenCalledWith(301);
    });

    it('(a) sad: deliver fuera de shipped → error que cita ship_order', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(ORDER_ROW);

      const result = await preview(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'deliver',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain("'processing'");
      expect(result.message).toContain('ship_order');
      expect(deps.orderFlowService.deliverOrder).not.toHaveBeenCalled();
    });

    it('(a) sad: deliver_item ya entregado → error sin mutar', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(SHIPPED);

      const answer = await run(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'deliver_item',
        order_item_id: 12,
      });

      expect(answer.error).toContain('Pan tajado');
      expect(answer.error).toContain('ya fue entregado');
      expect(deps.orderFlowService.deliverOrderItem).not.toHaveBeenCalled();
    });

    it('(a) sad: acción inexistente → error con válidos', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'teletransportar',
      });

      expect(answer.error).toContain('no existe');
      expect(deps.ordersService.findOne).not.toHaveBeenCalled();
    });

    it('(c) carrera: la orden salió de shipped antes del apply → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue({
        ...SHIPPED,
        state: 'delivered',
      });

      const answer = await run(tools, 'deliver_order_items', {
        order_id: 301,
        action: 'deliver',
      });

      expect(answer.error).toContain("'delivered'");
      expect(answer.next_step).toContain('get_order');
      expect(deps.orderFlowService.deliverOrder).not.toHaveBeenCalled();
    });
  });

  // ─── O-27 get_order_timeline ──────────────────────────────────────────
  describe('get_order_timeline', () => {
    const EVENTS = [
      {
        id: 1,
        event_type: 'state_changed',
        from_state: 'processing',
        to_state: 'shipped',
        actor: { user_id: 9, name: 'Ana Operadora' },
        actor_source: 'staff',
        payment_id: null,
        order_item_id: null,
        amount: null,
        payload: null,
        created_at: '2026-08-30T16:00:00.000Z',
      },
      {
        id: 2,
        event_type: 'payment_confirmed',
        from_state: null,
        to_state: null,
        actor: null,
        actor_source: 'system',
        payment_id: 77,
        order_item_id: null,
        amount: 59500,
        payload: null,
        created_at: '2026-08-30T15:30:00.000Z',
      },
    ];

    it('(b) happy: snapshot exacto con actor resuelto', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(ORDER_ROW);
      deps.ordersService.getTimeline.mockResolvedValue({
        legacy: false,
        events: EVENTS,
      });

      const answer = await run(tools, 'get_order_timeline', { order_id: 301 });

      expect(answer).toEqual({
        orden: {
          order_id: 301,
          numero: 'ORD260800301',
          estado: 'processing',
          cliente: 'Marcela Ríos',
        },
        total_eventos: 2,
        mostrando: 2,
        eventos: [
          {
            id: 1,
            tipo: 'state_changed',
            de: 'processing',
            a: 'shipped',
            actor: 'Ana Operadora',
            monto: 0,
            detalle: null,
            creada: '2026-08-30T16:00:00.000Z',
          },
          {
            id: 2,
            tipo: 'payment_confirmed',
            de: null,
            a: null,
            actor: null,
            monto: 59500,
            detalle: null,
            creada: '2026-08-30T15:30:00.000Z',
          },
        ],
      });
      expect(deps.ordersService.getTimeline).toHaveBeenCalledWith(301);
    });

    it('(b) legacy: avisa que el historial viene de auditoría', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(ORDER_ROW);
      deps.ordersService.getTimeline.mockResolvedValue({
        legacy: true,
        events: [],
      });

      const answer = await run(tools, 'get_order_timeline', { order_id: 301 });

      expect(answer.fuente).toBe('legacy');
      expect(answer.fuente_nota).toContain('auditoría');
      expect(answer.eventos).toEqual([]);
    });

    it('(a) sad: order_id inválido → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_order_timeline', { order_id: 0 });

      expect(answer.error).toContain('order_id inválido');
      expect(deps.ordersService.getTimeline).not.toHaveBeenCalled();
    });

    it('(c) el service lanza → {error, next_step}', async () => {
      const { deps, tools } = buildTools();
      deps.ordersService.findOne.mockResolvedValue(ORDER_ROW);
      deps.ordersService.getTimeline.mockRejectedValue(
        new Error('orden de otra tienda'),
      );

      const answer = await run(tools, 'get_order_timeline', { order_id: 301 });

      expect(answer.error).toContain('otra tienda');
      expect(answer.next_step).toContain('find_order');
    });
  });

  // ─── O-28 bulk_transition_orders ─────────────────────────────────────
  describe('bulk_transition_orders', () => {
    const DRY_RUN = {
      items: [
        {
          id: 301,
          order_number: 'ORD260800301',
          current_state: 'shipped',
          status: 'ok',
          message: 'Enviada → Entregada',
        },
        {
          id: 302,
          order_number: 'ORD260800302',
          current_state: 'delivered',
          status: 'skipped',
          code: 'ORD_BULK_ALREADY_IN_STATE',
          message: 'Ya está en Entregada',
        },
        {
          id: 303,
          order_number: 'ORD260800303',
          current_state: 'pending_payment',
          status: 'warning',
          code: 'ORD_BULK_FORCED_TRANSITION',
          message: 'Transición forzada',
        },
        {
          id: 999,
          order_number: '#999',
          current_state: 'desconocido',
          status: 'error',
          code: 'ORD_BULK_NOT_FOUND',
          message: 'La orden no existe o no pertenece a esta tienda',
        },
      ],
    };
    const ARGS = { order_ids: [301, 302, 303, 999], target_state: 'delivered' };

    it('(e) preview warning: clasifica ok/ya-está/forzada/inválida', async () => {
      const { deps, tools } = buildTools();
      deps.ordersBulkService.previewTransition.mockResolvedValue(DRY_RUN);

      const result = await preview(tools, 'bulk_transition_orders', ARGS);

      expect(result.status).toBe('warning');
      expect(result.target).toContain('delivered');
      expect(result.domain).toBe('orders');
      expect(result.changes[0]).toEqual({
        field: 'resumen',
        label: 'Clasificación del lote',
        from: null,
        to: '1 aplicables, 1 ya están en destino, 1 forzadas (auditadas), 1 inválidas (se omiten)',
      });
      expect(result.message).toContain('#999');
      expect(result.message).toContain('forzadas');
      expect(deps.ordersBulkService.bulkTransition).not.toHaveBeenCalled();
    });

    it('(b) happy: aplica y reporta por orden', async () => {
      const { deps, tools } = buildTools();
      deps.ordersBulkService.previewTransition.mockResolvedValue(DRY_RUN);
      deps.ordersBulkService.bulkTransition.mockResolvedValue({
        total: 4,
        successful: 2,
        failed: 2,
        results: [
          { id: 301, status: 'ok', message: 'Orden 301 → delivered' },
          { id: 302, status: 'ok', message: 'Orden 302 → delivered' },
          { id: 303, status: 'error', code: 'X', message: 'falló' },
          { id: 999, status: 'error', code: 'Y', message: 'no existe' },
        ],
      });

      const answer = await run(tools, 'bulk_transition_orders', ARGS);

      expect(answer.lote).toEqual({
        destino: 'delivered',
        total: 4,
        aplicadas: 2,
        fallidas: 2,
      });
      expect(answer.por_orden).toHaveLength(4);
      expect(answer.next_step).toContain('get_order_timeline');
      const [dto] = deps.ordersBulkService.bulkTransition.mock.calls[0];
      expect(dto.ids).toEqual([301, 302, 303, 999]);
      expect(dto.targetState).toBe('delivered');
    });

    it('(e) preview error cuando NADA del lote es válido', async () => {
      const { deps, tools } = buildTools();
      deps.ordersBulkService.previewTransition.mockResolvedValue({
        items: [DRY_RUN.items[3]],
      });

      const result = await preview(tools, 'bulk_transition_orders', {
        order_ids: [999],
        target_state: 'delivered',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('Ninguna orden del lote es válida');
      expect(deps.ordersBulkService.bulkTransition).not.toHaveBeenCalled();
    });

    it('(c) carrera: sin aplicables al re-verificar → no toca ninguna', async () => {
      const { deps, tools } = buildTools();
      deps.ordersBulkService.previewTransition.mockResolvedValue({
        items: [DRY_RUN.items[3]],
      });

      const answer = await run(tools, 'bulk_transition_orders', ARGS);

      expect(answer.error).toContain('ya no queda ninguna orden aplicable');
      expect(deps.ordersBulkService.bulkTransition).not.toHaveBeenCalled();
    });

    it('(a) sad: destino fuera del carril masivo → error de DTO', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'bulk_transition_orders', {
        order_ids: [301],
        target_state: 'draft',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('validación');
      expect(
        deps.ordersBulkService.previewTransition,
      ).not.toHaveBeenCalled();
    });
  });
});
