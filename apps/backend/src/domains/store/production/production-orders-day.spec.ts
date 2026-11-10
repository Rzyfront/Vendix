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

  beforeEach(() => {
    prisma = {
      production_orders: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('carries over in-progress orders from earlier days (multi-day production)', async () => {
    await service.findDay({ date: '2026-11-10' });

    const where = prisma.production_orders.findMany.mock.calls[0][0].where;
    const localStart = new Date('2026-11-10T05:00:00.000Z');
    const naiveStart = new Date('2026-11-10T00:00:00.000Z');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { status: 'in_progress', order_id: { not: null }, due_date: { lt: localStart } },
        { status: 'in_progress', order_id: null, due_date: { lt: naiveStart } },
        { status: 'in_progress', due_date: null, created_at: { lt: localStart } },
      ]),
    );
  });

  it('groups the orders of one sale into ONE card and gives each manual order its own card', async () => {
    prisma.production_orders.findMany.mockResolvedValue([
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
      planned_qty: 2,
      produced_qty: null,
      started_at: null,
      produced_at: null,
      due_date: '2026-11-10T17:00:00.000Z',
      created_at: '2026-11-09T20:00:00.000Z',
    });
  });

  it('derives the card status and counts the summary per production order', async () => {
    prisma.production_orders.findMany.mockResolvedValue([
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
    prisma.production_orders.findMany.mockResolvedValue([
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
    prisma.production_orders.findMany.mockResolvedValue([
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
});
