import { createCustomerTools, CustomerToolDeps } from './customers.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * T4 — Spec de contrato de la familia customers. Copia el patrón canónico
 * fijado en `products.tools.spec.ts`: (a) validación happy/sad sin tocar
 * deps en sad, (b) snapshot JSON exacto con `toEqual`, (c) forma
 * `{error, next_step}`, (d) permiso, (e) familia 100% `readOnly` — si se
 * agrega un write, el bloque de registro falla y obliga a extender la spec
 * con sus casos de confirmación + `preview`.
 *
 * Los relojes van congelados: `days_since_last_purchase` y el `period` de
 * segmentación se calculan contra `now`, y el snapshot exacto exige fechas
 * deterministas.
 */
describe('customers.tools · contrato T4', () => {
  const STORE_ID = 7;
  const NOW_ISO = '2026-09-01T12:00:00.000Z';

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW_ISO));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function baseDeps() {
    return {
      customersService: {
        findOne: jest.fn(),
        searchCustomerCardsForAgent: jest.fn(),
        findCustomerCitiesForAgent: jest.fn(),
        findCustomerNamesForAgent: jest.fn(),
        getPurchaseStatsForAgent: jest.fn(),
        getRecentOrdersForAgent: jest.fn(),
        getFinishedAggregateForAgent: jest.fn(),
        getOpenBalanceForAgent: jest.fn(),
        getBookingsCountForAgent: jest.fn(),
        getTopProductsForAgent: jest.fn(),
        getSegmentPopulationForAgent: jest.fn(),
        resolveCurrencyFromOrdersForAgent: jest.fn(),
      } as any,
    } satisfies CustomerToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createCustomerTools(deps) };
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
    it('expone exactamente los 3 tools del dominio customers', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'find_customer',
        'get_customer_history',
        'get_customer_segments',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('customers');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('todos exigen store:customers:read', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['store:customers:read']);
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
      expect(byName.get('find_customer')!.parameters.required).toEqual([
        'query',
      ]);
      expect(byName.get('get_customer_history')!.parameters.required).toEqual([
        'customer_id',
      ]);
      expect(
        byName.get('get_customer_segments')!.parameters.required ?? [],
      ).toEqual([]);
      expect(
        byName.get('get_customer_segments')!.parameters.properties.criteria
          .enum,
      ).toEqual(['rfm', 'spending', 'frequency']);
    });
  });

  // ─── find_customer ────────────────────────────────────────────────────
  describe('find_customer', () => {
    const USER_ROW = {
      id: 501,
      first_name: 'Marcela',
      last_name: 'Ríos',
      email: 'marcela@example.com',
      phone: '3001234567',
      document_type: 'CC',
      document_number: '12345678',
      state: 'active',
      created_at: new Date('2024-01-15T00:00:00.000Z'),
    };

    it('(b) happy: snapshot exacto de coincidencia única por nombre', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.searchCustomerCardsForAgent.mockResolvedValueOnce([
        USER_ROW,
      ]); // pase SQL por nombre
      deps.customersService.findCustomerCitiesForAgent.mockResolvedValueOnce([
        { id: 501, addresses: [{ city: 'Bogotá' }] },
      ]); // ciudad vía relación
      deps.customersService.getPurchaseStatsForAgent.mockResolvedValue([
        {
          customer_id: 501,
          _count: { _all: 3 },
          _sum: { grand_total: 150000 },
          _max: { created_at: new Date('2026-08-20T10:00:00.000Z') },
        },
      ]);
      deps.customersService.resolveCurrencyFromOrdersForAgent.mockResolvedValue(
        'COP',
      );

      const answer = await run(tools, 'find_customer', { query: 'Martinez' });

      expect(answer).toEqual({
        query: 'Martinez',
        matched_by: 'nombre',
        match_count: 1,
        ambiguous: false,
        currency: 'COP',
        customers: [
          {
            customer_id: 501,
            name: 'Marcela Ríos',
            document: 'CC 12345678',
            phone: '3001234567',
            email: 'marcela@example.com',
            city: 'Bogotá',
            state: 'active',
            finished_orders: 3,
            total_spent: 150000,
            last_purchase_at: '2026-08-20T10:00:00.000Z',
            days_since_last_purchase: 12,
          },
        ],
        next_step:
          'Usa customer_id con get_customer_history para ver su historial de compras.',
      });
    });

    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'find_customer', { query: 'Ríos' }, {});

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: los clientes se resuelven siempre dentro de una tienda.',
      });
      expect(
        deps.customersService.searchCustomerCardsForAgent,
      ).not.toHaveBeenCalled();
      expect(
        deps.customersService.getPurchaseStatsForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(a) sad: query de 1 carácter → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'find_customer', { query: 'x' });

      expect(answer).toEqual({
        error:
          'La búsqueda necesita al menos 2 caracteres. Pide al usuario el nombre, documento, teléfono o correo del cliente.',
      });
      expect(
        deps.customersService.searchCustomerCardsForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) sin coincidencias → match_count 0 con next_step que prohíbe inventar', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.searchCustomerCardsForAgent
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const answer = await run(tools, 'find_customer', { query: 'zzrt qq' });

      expect(answer).toEqual({
        query: 'zzrt qq',
        match_count: 0,
        customers: [],
        next_step:
          'Ningún cliente coincide. Pregunta al usuario por el documento o el teléfono; si tienes semantic_search disponible y lo describió de forma indirecta, pruébala. No inventes un customer_id.',
      });
      // Sin candidatos no hay agregados que cargar.
      expect(
        deps.customersService.getPurchaseStatsForAgent,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── get_customer_history ─────────────────────────────────────────────
  describe('get_customer_history', () => {
    it('(b) happy: snapshot exacto de la ficha', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.findOne.mockResolvedValue({
        id: 501,
        first_name: 'Marcela',
        last_name: 'Ríos',
        document_type: 'CC',
        document_number: '12345678',
        phone: '3001234567',
        email: 'marcela@example.com',
        state: 'active',
        person_type: 'natural',
        tax_regime: 'responsable_iva',
        is_withholding_agent: false,
        addresses: [{ city: 'Bogotá', address_line1: 'Calle 1 # 2-3' }],
        created_at: new Date('2024-01-15T00:00:00.000Z'),
      });
      deps.customersService.getRecentOrdersForAgent.mockResolvedValue([
        {
          id: 301,
          order_number: 'ORD-301',
          state: 'finished',
          channel: 'pos',
          grand_total: 100000,
          total_paid: 100000,
          remaining_balance: 0,
          currency: 'COP',
          created_at: new Date('2026-08-20T10:00:00.000Z'),
          completed_at: new Date('2026-08-20T11:00:00.000Z'),
        },
        {
          id: 295,
          order_number: 'ORD-295',
          state: 'processing',
          channel: 'ecommerce',
          grand_total: 50000,
          total_paid: 25000,
          remaining_balance: 25000,
          currency: 'COP',
          created_at: new Date('2026-08-25T10:00:00.000Z'),
          completed_at: null,
        },
      ]);
      deps.customersService.getFinishedAggregateForAgent.mockResolvedValue({
        _count: { _all: 3 },
        _sum: { grand_total: 150000 },
        _max: { created_at: new Date('2026-08-20T10:00:00.000Z') },
        _min: { created_at: new Date('2026-06-01T10:00:00.000Z') },
      });
      deps.customersService.getOpenBalanceForAgent.mockResolvedValue({
        _count: { _all: 1 },
        _sum: { remaining_balance: 25000 },
      });
      deps.customersService.getBookingsCountForAgent.mockResolvedValue(2);
      deps.customersService.getTopProductsForAgent.mockResolvedValue([
        {
          product_name: 'Coca Cola 1L',
          _sum: { quantity: 10, total_price: 50000 },
        },
      ]);

      const answer = await run(
        tools,
        'get_customer_history',
        { customer_id: 501 },
      );

      expect(deps.customersService.findOne).toHaveBeenCalledWith(STORE_ID, 501);
      expect(answer).toEqual({
        customer: {
          customer_id: 501,
          name: 'Marcela Ríos',
          document: 'CC 12345678',
          phone: '3001234567',
          email: 'marcela@example.com',
          state: 'active',
          person_type: 'natural',
          tax_regime: 'responsable_iva',
          is_withholding_agent: false,
          city: 'Bogotá',
          address: 'Calle 1 # 2-3',
          customer_since: '2024-01-15T00:00:00.000Z',
        },
        currency: 'COP',
        purchase_summary: {
          finished_orders: 3,
          total_spent: 150000,
          average_ticket: 50000,
          first_purchase_at: '2026-06-01T10:00:00.000Z',
          last_purchase_at: '2026-08-20T10:00:00.000Z',
          days_since_last_purchase: 12,
        },
        open_balance: {
          orders_with_balance: 1,
          amount_due: 25000,
          note: 'Suma de remaining_balance de órdenes vivas (excluye canceladas, reembolsadas y borradores).',
        },
        bookings_count: 2,
        recent_orders: [
          {
            order_id: 301,
            order_number: 'ORD-301',
            state: 'finished',
            channel: 'pos',
            total: 100000,
            paid: 100000,
            balance: 0,
            created_at: '2026-08-20T10:00:00.000Z',
            completed_at: '2026-08-20T11:00:00.000Z',
          },
          {
            order_id: 295,
            order_number: 'ORD-295',
            state: 'processing',
            channel: 'ecommerce',
            total: 50000,
            paid: 25000,
            balance: 25000,
            created_at: '2026-08-25T10:00:00.000Z',
            completed_at: null,
          },
        ],
        top_products: [{ product: 'Coca Cola 1L', units: 10, amount: 50000 }],
        note: 'Los importes gastados solo cuentan órdenes en estado finished; recent_orders muestra todos los estados.',
      });
    });

    it('(a) sad: customer_id inválido → error sin llamar al service', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_customer_history',
        { customer_id: 'x' },
      );

      expect(answer).toEqual({
        error:
          'customer_id inválido. Resuelve el cliente con find_customer antes de pedir su historial.',
      });
      expect(deps.customersService.findOne).not.toHaveBeenCalled();
      expect(
        deps.customersService.getRecentOrdersForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) service lanza → {error, next_step} hacia find_customer', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.findOne.mockRejectedValue(new Error('no existe'));

      const answer = await run(
        tools,
        'get_customer_history',
        { customer_id: 999 },
      );

      expect(answer).toEqual({
        error: 'No existe un cliente con id 999 en esta tienda.',
        next_step:
          'Usa find_customer con el nombre, documento o teléfono para obtener el customer_id correcto.',
      });
      expect(
        deps.customersService.getRecentOrdersForAgent,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── get_customer_segments ────────────────────────────────────────────
  describe('get_customer_segments', () => {
    it('(b) happy: snapshot exacto por frecuencia', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.getSegmentPopulationForAgent.mockResolvedValue([
        {
          customer_id: 501,
          _count: { _all: 2 },
          _sum: { grand_total: 100000 },
          _max: { created_at: new Date('2026-08-28T10:00:00.000Z') },
        },
        {
          customer_id: 502,
          _count: { _all: 8 },
          _sum: { grand_total: 800000 },
          _max: { created_at: new Date('2026-08-15T10:00:00.000Z') },
        },
        {
          customer_id: 503,
          _count: { _all: 3 },
          _sum: { grand_total: 300000 },
          _max: { created_at: new Date('2026-07-01T10:00:00.000Z') },
        },
      ]);
      deps.customersService.findCustomerNamesForAgent.mockResolvedValue([
        { id: 501, first_name: 'Ana', last_name: 'Ríos' },
        { id: 502, first_name: 'Luis', last_name: 'Pardo' },
        { id: 503, first_name: 'Marta', last_name: 'Gil' },
      ]);
      deps.customersService.resolveCurrencyFromOrdersForAgent.mockResolvedValue(
        'COP',
      );

      const answer = await run(
        tools,
        'get_customer_segments',
        { criteria: 'frequency' },
      );

      expect(answer).toEqual({
        criteria: 'frequency',
        period: {
          days: 365,
          from: '2025-09-01T12:00:00.000Z',
          to: NOW_ISO,
        },
        currency: 'COP',
        customers_analyzed: 3,
        orders_considered: 13,
        segments: [
          {
            segment: '2 a 3 compras',
            definition: 'Clientes con 2 a 3 compras en el período.',
            customers: 2,
            share_pct: 66.67,
            avg_orders: 2.5,
            avg_spent: 200000,
            total_spent: 400000,
            examples: [
              {
                customer_id: 503,
                name: 'Marta Gil',
                orders: 3,
                spent: 300000,
                days_since_last_purchase: 62,
              },
              {
                customer_id: 501,
                name: 'Ana Ríos',
                orders: 2,
                spent: 100000,
                days_since_last_purchase: 4,
              },
            ],
          },
          {
            segment: '7 a 12 compras',
            definition: 'Clientes con 7 a 12 compras en el período.',
            customers: 1,
            share_pct: 33.33,
            avg_orders: 8,
            avg_spent: 800000,
            total_spent: 800000,
            examples: [
              {
                customer_id: 502,
                name: 'Luis Pardo',
                orders: 8,
                spent: 800000,
                days_since_last_purchase: 17,
              },
            ],
          },
        ],
        note: 'Solo se cuentan órdenes en estado finished dentro del período. Los clientes sin ninguna compra en la ventana no aparecen en ningún grupo.',
      });
    });

    it('(a) sad: sin tienda → error y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_customer_segments', {}, {});

      expect(answer).toEqual({
        error:
          'Sin tienda en contexto: la segmentación se calcula por tienda.',
      });
      expect(
        deps.customersService.getSegmentPopulationForAgent,
      ).not.toHaveBeenCalled();
    });

    it('(c) población vacía → segmentos vacíos con nota de period_days', async () => {
      const { deps, tools } = buildTools();
      deps.customersService.getSegmentPopulationForAgent.mockResolvedValue([]);

      const answer = await run(
        tools,
        'get_customer_segments',
        { criteria: 'rfm' },
      );

      expect(answer).toEqual({
        criteria: 'rfm',
        period: { days: 365, from: '2025-09-01T12:00:00.000Z' },
        customers_analyzed: 0,
        segments: [],
        note: 'No hay órdenes finalizadas en el período: no se puede segmentar todavía. Prueba con un period_days mayor.',
      });
      expect(
        deps.customersService.findCustomerNamesForAgent,
      ).not.toHaveBeenCalled();
    });
  });
});
