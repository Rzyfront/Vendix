import { order_channel_enum, order_state_enum } from '@prisma/client';
import { SORTABLE_COLUMNS } from '../../../domains/store/orders/orders.service';
import { createOrdersTools, OrdersToolDeps } from './orders.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

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

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = { store_id: STORE_ID, user_id: 9 },
  ) => JSON.parse(await getHandler(tools, name)(args, context as any));

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
    it('expone exactamente los 5 tools del dominio orders', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'find_order',
        'list_orders',
        'get_order',
        'get_cash_session_status',
        'get_dispatch_status',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('orders');
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
});
