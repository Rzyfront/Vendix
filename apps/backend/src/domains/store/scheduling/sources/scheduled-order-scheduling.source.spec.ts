import {
  ScheduledOrderSchedulingSource,
  SCHEDULED_ORDER_READ_CAP,
  scheduleRangeWhere,
} from './scheduled-order-scheduling.source';

const TZ = 'America/Bogota';

function schedule(id: number, start: string, overrides: Record<string, any> = {}) {
  const s = new Date(start);
  return {
    id,
    order_id: 100 + id,
    scheduled_start: s,
    scheduled_end: new Date(s.getTime() + 60 * 60 * 1000),
    fulfillment_type: 'pickup',
    status: 'scheduled',
    produced_at: null,
    order: {
      id: 100 + id,
      order_number: `ORD-${id}`,
      state: 'processing',
      customer_id: null,
      customer_alias: 'Mesa 4',
      users: null,
      production_orders: [],
    },
    ...overrides,
  };
}

describe('ScheduledOrderSchedulingSource (agenda-unificada F1)', () => {
  let prisma: any;
  let groupBy: jest.Mock;
  let source: ScheduledOrderSchedulingSource;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-23T12:00:00.000Z'));
    groupBy = jest.fn().mockResolvedValue([]);
    prisma = {
      order_fulfillment_schedules: { findMany: jest.fn() },
      withoutScope: jest.fn(() => ({ order_items: { groupBy } })),
    };
    source = new ScheduledOrderSchedulingSource(prisma);
  });

  afterEach(() => jest.useRealTimers());

  it('el rango local de la tienda se convierte a instantes UTC [desde, hasta+1)', () => {
    expect(scheduleRangeWhere({ from: '2026-11-23', to: '2026-11-24' }, TZ)).toEqual({
      gte: new Date('2026-11-23T05:00:00.000Z'),
      lt: new Date('2026-11-25T05:00:00.000Z'),
    });
    expect(scheduleRangeWhere({}, TZ)).toBeUndefined();
  });

  it('con filtro de personal no aplica y no consulta la base', async () => {
    const page = await source.fetch({ store_id: 7, timezone: TZ }, { order: 'asc', staff_ids: [3] }, 20);
    expect(page).toEqual({ total: 0, events: [], truncated: false });
    expect(prisma.order_fulfillment_schedules.findMany).not.toHaveBeenCalled();
  });

  it('deriva el estado visible con UNA lectura agrupada de cocina y filtra por grupo', async () => {
    prisma.order_fulfillment_schedules.findMany.mockResolvedValue([
      schedule(1, '2026-11-23T20:00:00.000Z'),
      // Venta cancelada → cancelada.
      schedule(2, '2026-11-23T21:00:00.000Z', {
        order: { ...schedule(2, '2026-11-23T21:00:00.000Z').order, state: 'cancelled' },
      }),
      // Franja ya pasada sin entregar → vencido.
      schedule(3, '2026-11-22T15:00:00.000Z'),
    ]);
    const page = await source.fetch(
      { store_id: 7, timezone: TZ },
      { order: 'asc', status_groups: ['confirmed', 'no_show'] },
      20,
    );
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0][0].where.order_id).toEqual({ in: [101, 102, 103] });
    expect(groupBy.mock.calls[0][0].where.orders).toEqual({ store_id: 7 });
    expect(page.total).toBe(2);
    expect(page.events.map((e) => [e.source_id, e.status, e.status_group])).toEqual([
      [3, 'expired', 'no_show'],
      [1, 'scheduled', 'confirmed'],
    ]);
    expect(page.events[1]).toMatchObject({
      id: 'scheduled_order:1',
      reference: 'ORD-1',
      date: '2026-11-23',
      local_start: '15:00',
      local_end: '16:00',
      customer: { id: null, name: 'Mesa 4' },
      order_id: 101,
      detail: 'Recoger en tienda',
      staff: null,
    });
  });

  it('respeta el tope de lectura y lo informa como truncado', async () => {
    const rows = Array.from({ length: SCHEDULED_ORDER_READ_CAP + 1 }, (_, i) =>
      schedule(i + 1, '2026-11-24T15:00:00.000Z'),
    );
    prisma.order_fulfillment_schedules.findMany.mockResolvedValue(rows);
    const page = await source.fetch({ store_id: 7, timezone: TZ }, { order: 'asc' }, 10);
    expect(prisma.order_fulfillment_schedules.findMany.mock.calls[0][0].take).toBe(
      SCHEDULED_ORDER_READ_CAP + 1,
    );
    expect(page.truncated).toBe(true);
    expect(page.total).toBe(SCHEDULED_ORDER_READ_CAP);
    expect(page.events).toHaveLength(10);
  });

  it('la búsqueda va a la base sobre número de pedido y cliente', async () => {
    prisma.order_fulfillment_schedules.findMany.mockResolvedValue([]);
    await source.fetch({ store_id: 7, timezone: TZ }, { order: 'asc', search: 'ord-1' }, 10);
    const where = prisma.order_fulfillment_schedules.findMany.mock.calls[0][0].where;
    expect(where.order.OR).toHaveLength(4);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
