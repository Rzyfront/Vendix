import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from './production-orders.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * QUI-996 — the production list of ONE day (store timezone): cards per sale
 * (all its production orders) or per manual order, sorted by the time they
 * anchor on the timeline; in-progress orders from earlier days carry over.
 */
describe('ProductionOrdersService.findDay (QUI-996)', () => {
  let prisma: any;
  let service: ProductionOrdersService;

  const row = (over: Record<string, unknown>) => ({
    id: 1,
    order_number: 'OP-000001',
    status: 'draft',
    source: 'order',
    product_id: 50,
    planned_qty: new Prisma.Decimal(2),
    produced_qty: null,
    started_at: null,
    produced_at: null,
    due_date: new Date('2026-11-10T17:00:00Z'),
    created_at: new Date('2026-11-09T20:00:00Z'),
    order_id: 77,
    product: { name: 'Torta' },
    sale_order: {
      order_number: 'POS-0077',
      customer_alias: null,
      users: { first_name: 'Ana', last_name: 'Ruiz' },
    },
    ...over,
  });

  // El resumen sale de un conteo por estado del día completo (S20).
  const mockRows = (rows: any[]) => {
    prisma.production_orders.findMany.mockResolvedValue(rows);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    prisma.production_orders.groupBy.mockResolvedValue(
      [...counts].map(([status, n]) => ({ status, _count: { _all: n } })),
    );
  };

  beforeEach(() => {
    prisma = {
      production_orders: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {},
          stores: { timezone: 'America/Bogota' },
        }),
      },
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 9 } as any);
    service = new ProductionOrdersService(prisma, {} as any, {} as any, { emit: jest.fn() } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('filters the local day: linked orders by delivery instant, manual by planned date or creation, never cancelled', async () => {
    await service.findDay({ date: '2026-11-10' });

    const where = prisma.production_orders.findMany.mock.calls[0][0].where;
    const localStart = new Date('2026-11-10T05:00:00.000Z');
    const localEnd = new Date('2026-11-11T04:59:59.999Z');
    const naiveStart = new Date('2026-11-10T00:00:00.000Z');
    const naiveEnd = new Date('2026-11-10T23:59:59.999Z');
    expect(where.status).toEqual({ not: 'cancelled' });
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { order_id: { not: null }, due_date: { gte: localStart, lte: localEnd } },
        { order_id: null, due_date: { gte: naiveStart, lte: naiveEnd } },
        { due_date: null, created_at: { gte: localStart, lte: localEnd } },
      ]),
    );
  });

  it('S16: carries over in-progress and partially completed orders from earlier days (multi-day production)', async () => {
    await service.findDay({ date: '2026-11-10' });

    const where = prisma.production_orders.findMany.mock.calls[0][0].where;
    const localStart = new Date('2026-11-10T05:00:00.000Z');
    const naiveStart = new Date('2026-11-10T00:00:00.000Z');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { status: { in: ['in_progress', 'partially_completed'] }, order_id: { not: null }, due_date: { lt: localStart } },
        { status: { in: ['in_progress', 'partially_completed'] }, order_id: null, due_date: { lt: naiveStart } },
        { status: { in: ['in_progress', 'partially_completed'] }, due_date: null, created_at: { lt: localStart } },
      ]),
    );
  });

  it('S16: a partially completed order counts as in progress in the card and the summary', async () => {
    mockRows([
      row({
        id: 1,
        status: 'partially_completed',
        source: 'manual',
        order_id: null,
        sale_order: null,
        started_at: new Date('2026-11-10T15:00:00Z'),
      }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });

    expect(day.cards[0].status).toBe('in_progress');
    expect(day.summary).toEqual({ waiting: 0, in_progress: 1, completed: 0 });
    expect(day.cards[0].production_orders[0].status).toBe('partially_completed');
  });

  it('S19: exposes the variant name of an order (null without variant) and selects it', async () => {
    mockRows([
      row({ id: 1, product_variant_id: 7, product_variant: { name: 'Chocolate' } }),
      row({ id: 2, product_id: 51, product_variant_id: null, product_variant: null }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });

    const [a, b] = day.cards[0].production_orders;
    expect(a.variant_name).toBe('Chocolate');
    expect(b.variant_name).toBeNull();
    expect(prisma.production_orders.findMany.mock.calls[0][0].select.product_variant).toEqual({
      select: { name: true },
    });
  });

  it('groups the orders of one sale into ONE card and gives each manual order its own card', async () => {
    mockRows([
      row({ id: 1, product_id: 50, product: { name: 'Torta' } }),
      row({ id: 2, order_number: 'OP-000002', product_id: 51, product: { name: 'Pan' } }),
      row({
        id: 3,
        order_number: 'OP-000003',
        source: 'manual',
        order_id: null,
        sale_order: null,
        due_date: null,
        created_at: new Date('2026-11-10T13:00:00Z'),
      }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });

    expect(day.date).toBe('2026-11-10');
    expect(day.timezone).toBe('America/Bogota');
    expect(day.cards).toHaveLength(2);
    const [manual, sale] = day.cards;
    expect(manual).toMatchObject({
      key: 'po-3',
      kind: 'manual',
      order_id: null,
      sale_order_number: null,
      due_at: '2026-11-10T13:00:00.000Z',
      carried_over: false,
    });
    expect(sale).toMatchObject({
      key: 'sale-77',
      kind: 'sale',
      order_id: 77,
      sale_order_number: 'POS-0077',
      customer_name: 'Ana Ruiz',
      due_at: '2026-11-10T17:00:00.000Z',
      status: 'waiting',
      carried_over: false,
    });
    expect(sale.production_orders.map((o) => o.id)).toEqual([1, 2]);
    expect(sale.production_orders[0]).toEqual({
      id: 1,
      order_number: 'OP-000001',
      status: 'draft',
      source: 'order',
      product_id: 50,
      product_name: 'Torta',
      variant_name: null,
      planned_qty: 2,
      produced_qty: null,
      started_at: null,
      produced_at: null,
      estimated_minutes: null,
      effective_estimated_minutes: null,
      due_date: '2026-11-10T17:00:00.000Z',
      created_at: '2026-11-09T20:00:00.000Z',
    });
  });

  it('derives the card status and counts the summary per production order', async () => {
    mockRows([
      row({ id: 1, status: 'completed', produced_at: new Date('2026-11-10T16:00:00Z') }),
      row({ id: 2, status: 'draft', product_id: 51 }),
      row({ id: 3, order_id: 78, sale_order: { order_number: 'POS-0078', customer_alias: 'Mesa 4', users: null }, status: 'completed' }),
      row({ id: 4, order_id: 79, sale_order: { order_number: 'POS-0079', customer_alias: null, users: null }, status: 'in_progress', started_at: new Date('2026-11-10T15:00:00Z') }),
      row({ id: 5, order_id: 80, sale_order: { order_number: 'POS-0080', customer_alias: null, users: null }, status: 'released', source: 'manual' }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });
    const byKey = Object.fromEntries(day.cards.map((c) => [c.key, c]));

    expect(byKey['sale-77'].status).toBe('in_progress');
    expect(byKey['sale-78'].status).toBe('completed');
    expect(byKey['sale-78'].customer_name).toBe('Mesa 4');
    expect(byKey['sale-79'].status).toBe('in_progress');
    expect(byKey['sale-80'].status).toBe('waiting');
    expect(day.summary).toEqual({ waiting: 2, in_progress: 1, completed: 2 });
  });

  it('puts carried-over cards first, then sorts by the timeline time', async () => {
    mockRows([
      row({ id: 1, order_id: 77, due_date: new Date('2026-11-10T20:00:00Z') }),
      row({ id: 2, order_id: 78, due_date: new Date('2026-11-10T14:00:00Z') }),
      row({
        id: 3,
        order_id: 79,
        status: 'in_progress',
        due_date: new Date('2026-11-08T14:00:00Z'),
        started_at: new Date('2026-11-08T13:00:00Z'),
      }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });

    expect(day.cards.map((c) => c.key)).toEqual(['sale-79', 'sale-78', 'sale-77']);
    expect(day.cards[0].carried_over).toBe(true);
    expect(day.cards[1].carried_over).toBe(false);
  });

  it('a manual order planned for an earlier date and still in progress is carried over', async () => {
    mockRows([
      row({
        id: 9,
        source: 'manual',
        order_id: null,
        sale_order: null,
        status: 'in_progress',
        due_date: new Date('2026-11-09T00:00:00Z'),
        created_at: new Date('2026-11-08T15:00:00Z'),
      }),
    ]);

    const day = await service.findDay({ date: '2026-11-10' });

    expect(day.cards[0]).toMatchObject({ key: 'po-9', carried_over: true });
  });

  it('defaults to today in the store timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-11T03:00:00Z'));

    const day = await service.findDay({});

    expect(day.date).toBe('2026-11-10');
  });

  // ---------------------------------------------------------------- S20 / S25
  describe('paginación y reloj (S20, S25)', () => {
    const base = (id: number, over: Record<string, unknown> = {}) =>
      row({
        id,
        order_number: `OP-${id}`,
        order_id: 100 + id,
        sale_order: { order_number: `POS-${id}`, customer_alias: null, users: null },
        due_date: new Date(`2026-11-10T1${id}:00:00Z`),
        created_at: new Date('2026-11-09T20:00:00Z'),
        ...over,
      });

    it('sin limit ni cursor: pide hasta 500 (+1 para detectar más), misma forma y next_cursor null', async () => {
      mockRows([base(1)]);

      const day = await service.findDay({ date: '2026-11-10' });

      const args = prisma.production_orders.findMany.mock.calls[0][0];
      expect(args.take).toBe(501);
      expect(args.where.status).toEqual({ not: 'cancelled' });
      expect(args.where.AND).toBeUndefined();
      expect(prisma.production_orders.findMany).toHaveBeenCalledTimes(1);
      expect(day.next_cursor).toBeNull();
      expect(day.cards).toHaveLength(1);
      expect(day.summary).toEqual({ waiting: 1, in_progress: 0, completed: 0 });
    });

    it('con limit: devuelve solo la página, next_cursor de su última fila y el resumen del día completo', async () => {
      const all = [base(1), base(2), base(3)];
      prisma.production_orders.findMany
        .mockResolvedValueOnce(all) // limit + 1 filas
        .mockResolvedValueOnce(all.slice(0, 2)); // hermanas de las ventas de la página
      prisma.production_orders.groupBy.mockResolvedValue([
        { status: 'draft', _count: { _all: 40 } },
        { status: 'in_progress', _count: { _all: 3 } },
        { status: 'completed', _count: { _all: 7 } },
      ]);

      const day = await service.findDay({ date: '2026-11-10', limit: 2 });

      expect(prisma.production_orders.findMany.mock.calls[0][0].take).toBe(3);
      expect(day.cards.map((c) => c.key)).toEqual(['sale-101', 'sale-102']);
      expect(day.summary).toEqual({ waiting: 40, in_progress: 3, completed: 7 });
      expect(prisma.production_orders.groupBy.mock.calls[0][0].where.status).toEqual({
        not: 'cancelled',
      });
      const cursor = JSON.parse(Buffer.from(day.next_cursor as string, 'base64url').toString());
      expect(cursor).toEqual({ d: '2026-11-10T12:00:00.000Z', i: 2 });
      expect(prisma.production_orders.findMany.mock.calls[0][0].orderBy).toEqual([
        { due_date: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('con cursor: el where agrega el keyset posterior a la última fila y completa las filas de las ventas', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ d: '2026-11-10T12:00:00.000Z', i: 2 }),
      ).toString('base64url');
      mockRows([base(3)]);

      const day = await service.findDay({ date: '2026-11-10', limit: 2, cursor });

      const first = prisma.production_orders.findMany.mock.calls[0][0];
      expect(first.where.AND).toEqual([
        {
          OR: [
            { due_date: { gte: new Date('2026-11-10T12:00:00.001Z') } },
            { due_date: null },
            {
              due_date: {
                gte: new Date('2026-11-10T12:00:00.000Z'),
                lt: new Date('2026-11-10T12:00:00.001Z'),
              },
              id: { gt: 2 },
            },
          ],
        },
      ]);
      // La completación por order_id corre con el mismo where del día.
      const sib = prisma.production_orders.findMany.mock.calls[1][0];
      expect(sib.where.OR).toEqual(first.where.OR);
      expect(sib.where.AND).toEqual([{ order_id: { in: [103] } }]);
      // Duplicados entre página y hermanas no producen filas dobles.
      expect(day.cards[0].production_orders).toHaveLength(1);
      expect(day.next_cursor).toBeNull();
    });

    it('cursor de fila sin due_date: solo filas posteriores entre las de due_date nulo', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ d: null, i: 9 }),
      ).toString('base64url');
      mockRows([]);

      await service.findDay({ date: '2026-11-10', cursor });

      const where = prisma.production_orders.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([{ due_date: null, id: { gt: 9 } }]);
    });

    it('filas de una misma transacción (created_at idéntico, sin due_date) avanzan por id sin repetir la del cursor', async () => {
      const sameTx = new Date('2026-11-10T13:00:00.123Z');
      const r = (id: number) => base(id, { order_id: null, due_date: null, created_at: sameTx });
      prisma.production_orders.findMany.mockResolvedValueOnce([r(10), r(11), r(12)]);
      const first = await service.findDay({ date: '2026-11-10', limit: 2 });
      const cursor = JSON.parse(Buffer.from(first.next_cursor as string, 'base64url').toString());
      expect(cursor).toEqual({ d: null, i: 11 });

      prisma.production_orders.findMany.mockClear();
      prisma.production_orders.findMany.mockResolvedValueOnce([r(12)]);
      const second = await service.findDay({ date: '2026-11-10', limit: 2, cursor: first.next_cursor as string });
      expect(prisma.production_orders.findMany.mock.calls[0][0].where.AND).toEqual([
        { due_date: null, id: { gt: 11 } },
      ]);
      expect(second.next_cursor).toBeNull();
    });

    it('una venta con filas en dos páginas trae todas sus filas del día en la tarjeta', async () => {
      const a = base(1, { order_id: 500, id: 1 });
      const b = base(2, { order_id: 500, id: 2, due_date: new Date('2026-11-10T12:00:00Z') });
      const c = base(3, { order_id: 600, id: 3 });
      prisma.production_orders.findMany
        .mockResolvedValueOnce([a, c]) // página 1 (limit 1 + 1)
        .mockResolvedValueOnce([a, b]); // hermanas de la venta 500
      const day = await service.findDay({ date: '2026-11-10', limit: 1 });

      expect(day.cards).toHaveLength(1);
      expect(day.cards[0].key).toBe('sale-500');
      expect(day.cards[0].production_orders.map((o) => o.id)).toEqual([1, 2]);
    });

    it('un cursor ilegible responde SYS_VALIDATION_001', async () => {
      await expect(
        service.findDay({ date: '2026-11-10', cursor: 'no-es-un-cursor' }),
      ).rejects.toMatchObject({ response: { error_code: 'SYS_VALIDATION_001' } });
      expect(prisma.production_orders.findMany).not.toHaveBeenCalled();
    });

    it('S25: la respuesta trae server_now en ISO con la hora del servidor', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-10T18:30:00Z'));

      const day = await service.findDay({ date: '2026-11-10' });

      expect(day.server_now).toBe('2026-11-10T18:30:00.000Z');
    });
  });
});
