import { ScheduledOrderRemindersJob } from './scheduled-order-reminders.job';

const NOW = new Date('2026-11-02T15:00:00.000Z'); // 10:00 en Bogotá

function schedule(id: number, start: Date, email: string | null = 'ana@example.com') {
  return {
    id,
    scheduled_start: start,
    scheduled_end: new Date(start.getTime() + 2 * 3600 * 1000),
    fulfillment_type: 'pickup',
    order: { id: 100 + id, order_number: `ORD-${id}`, users: { first_name: 'Ana', last_name: 'Pérez', email } },
  };
}

function build(opts: { enabled?: boolean; schedules: (where: any) => any[] }) {
  const logs = new Set<string>();
  const db = {
    store_settings: {
      findMany: jest.fn().mockResolvedValue([
        {
          store_id: 1,
          stores: { name: 'Repostería demo', timezone: 'America/Bogota' },
          settings: {
            scheduled_orders: {
              enabled: opts.enabled ?? true,
              reminders: [
                { minutes_before: 1440, enabled: true, notify_staff: true, notify_customer: true },
                { minutes_before: 120, enabled: true, notify_staff: true, notify_customer: false },
              ],
            },
          },
        },
      ]),
    },
    order_fulfillment_schedules: { findMany: jest.fn(async ({ where }) => opts.schedules(where)) },
    scheduled_order_reminder_logs: {
      createMany: jest.fn(async ({ data }) => {
        const key = `${data[0].schedule_id}|${data[0].rule_key}|${data[0].channel}`;
        if (logs.has(key)) return { count: 0 };
        logs.add(key);
        return { count: 1 };
      }),
    },
  };
  const eventEmitter = { emit: jest.fn() };
  const job = new ScheduledOrderRemindersJob({ withoutScope: () => db } as any, eventEmitter as any);
  return { job, db, eventEmitter };
}

// Devuelve los agendamientos cuyo inicio cae en la ventana pedida.
function inWindow(list: ReturnType<typeof schedule>[]) {
  return (where: any) =>
    list.filter((s) => s.scheduled_start > where.scheduled_start.gt && s.scheduled_start <= where.scheduled_start.lte);
}

describe('ScheduledOrderRemindersJob', () => {
  const in24h = schedule(1, new Date(NOW.getTime() + 24 * 3600 * 1000 - 60 * 1000));
  const in2h = schedule(2, new Date(NOW.getTime() + 2 * 3600 * 1000 - 3 * 60 * 1000));

  it('24 h: avisa al equipo y al cliente; 2 h: solo al equipo', async () => {
    const { job, eventEmitter } = build({ schedules: inWindow([in24h, in2h]) });
    expect(await job.run(NOW)).toBe(3);
    const events = eventEmitter.emit.mock.calls.map(([name, e]) => [name, e.schedule_id, e.channel, e.minutes_before]);
    expect(events).toEqual([
      ['scheduled_order.reminder', 1, 'staff', 1440],
      ['scheduled_order.reminder', 1, 'customer', 1440],
      ['scheduled_order.reminder', 2, 'staff', 120],
    ]);
    expect(eventEmitter.emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({ local_date: '2026-11-03', local_start: '09:59', order_number: 'ORD-1' }),
    );
  });

  it('una sola vez por regla y canal: la segunda corrida no repite', async () => {
    const { job, eventEmitter } = build({ schedules: inWindow([in24h, in2h]) });
    await job.run(NOW);
    eventEmitter.emit.mockClear();
    expect(await job.run(new Date(NOW.getTime() + 5 * 60 * 1000))).toBe(0);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('sin email del cliente no emite el canal cliente; ajuste apagado no hace nada', async () => {
    const noEmail = schedule(3, in24h.scheduled_start, null);
    const a = build({ schedules: inWindow([noEmail]) });
    expect(await a.job.run(NOW)).toBe(1);
    const b = build({ enabled: false, schedules: inWindow([in24h]) });
    expect(await b.job.run(NOW)).toBe(0);
    expect(b.db.order_fulfillment_schedules.findMany).not.toHaveBeenCalled();
  });

  it('solo busca pedidos por entregar y en la ventana de la regla', async () => {
    const { job, db } = build({ schedules: () => [] });
    await job.run(NOW);
    const where = db.order_fulfillment_schedules.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['scheduled', 'in_production', 'ready'] });
    expect(where.scheduled_start.lte).toEqual(new Date(NOW.getTime() + 1440 * 60 * 1000));
  });
});
