import {
  CreditInstallmentRemindersJob,
  addDaysToCivilDate,
} from './credit-installment-reminders.job';

// 2026-11-30 10:00 en Bogotá (UTC-5).
const NOW = new Date('2026-11-30T15:00:00.000Z');

function installment(id: number, dueDate: string, email: string | null = 'ana@example.com') {
  return {
    id,
    installment_number: 1,
    amount: '6666.66',
    remaining_balance: '6666.66',
    due_date: new Date(`${dueDate}T00:00:00.000Z`),
    orders: {
      id: 100 + id,
      order_number: `POS-${id}`,
      remaining_balance: '20000',
      users: { first_name: 'Ana', last_name: 'Pérez', email },
      order_installments: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
  };
}

function build(opts: {
  enabled?: boolean;
  installments: ReturnType<typeof installment>[];
}) {
  const logs = new Set<string>();
  const db = {
    store_settings: {
      findMany: jest.fn().mockResolvedValue([
        {
          store_id: 1,
          stores: { name: 'Nike', timezone: 'America/Bogota' },
          settings: {
            credit_reminders: {
              enabled: opts.enabled ?? true,
              reminders: [
                { days_before: 3, enabled: true, notify_staff: true, notify_customer: true },
                { days_before: 0, enabled: true, notify_staff: true, notify_customer: false },
              ],
            },
          },
        },
      ]),
    },
    order_installments: {
      findMany: jest.fn(async ({ where }) =>
        opts.installments.filter(
          (i) => i.due_date.getTime() === where.due_date.getTime(),
        ),
      ),
    },
    credit_installment_reminder_logs: {
      createMany: jest.fn(async ({ data }) => {
        const key = `${data[0].installment_id}|${data[0].rule_key}|${data[0].channel}`;
        if (logs.has(key)) return { count: 0 };
        logs.add(key);
        return { count: 1 };
      }),
    },
  };
  const eventEmitter = { emit: jest.fn() };
  const job = new CreditInstallmentRemindersJob(
    { withoutScope: () => db } as any,
    eventEmitter as any,
  );
  return { job, db, eventEmitter };
}

const emitted = (eventEmitter: { emit: jest.Mock }) =>
  eventEmitter.emit.mock.calls.map(([, e]) => `${e.order_number}:${e.channel}:${e.days_before}`);

describe('CreditInstallmentRemindersJob', () => {
  it('3 días antes avisa a tienda y cliente; el mismo día solo a la tienda', async () => {
    const { job, eventEmitter } = build({
      installments: [installment(1, '2026-12-03'), installment(2, '2026-11-30')],
    });

    expect(await job.run(NOW)).toBe(3);
    expect(emitted(eventEmitter)).toEqual([
      'POS-1:staff:3',
      'POS-1:customer:3',
      'POS-2:staff:0',
    ]);
    const [name, event] = eventEmitter.emit.mock.calls[1];
    expect(name).toBe('credit_installment.reminder');
    expect(event).toEqual(
      expect.objectContaining({
        installment_number: 1,
        installments_total: 3,
        due_date: '2026-12-03',
        amount: 6666.66,
        credit_balance: 20000,
        customer_email: 'ana@example.com',
        customer_name: 'Ana Pérez',
      }),
    );
  });

  it('nunca envía el mismo aviso dos veces', async () => {
    const { job, eventEmitter } = build({ installments: [installment(1, '2026-12-03')] });

    await job.run(NOW);
    await job.run(new Date(NOW.getTime() + 3600 * 1000));

    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('con el ajuste apagado no consulta ni envía nada', async () => {
    const { job, db, eventEmitter } = build({
      enabled: false,
      installments: [installment(1, '2026-12-03')],
    });

    expect(await job.run(NOW)).toBe(0);
    expect(db.order_installments.findMany).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('antes de la hora de envío local no envía (02:00 en Bogotá)', async () => {
    const { job, eventEmitter } = build({ installments: [installment(1, '2026-12-03')] });

    expect(await job.run(new Date('2026-11-30T07:00:00.000Z'))).toBe(0);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('usa la fecha local de la tienda, no la UTC', async () => {
    // 2026-11-30 21:00 en Bogotá = 2026-12-01 02:00 UTC: "hoy" sigue siendo 30/11.
    const { job, db } = build({ installments: [] });

    await job.run(new Date('2026-12-01T02:00:00.000Z'));

    const dueDates = db.order_installments.findMany.mock.calls.map(
      ([args]) => args.where.due_date.toISOString().slice(0, 10),
    );
    expect(dueDates).toEqual(['2026-12-03', '2026-11-30']);
  });

  it('cliente sin correo: solo la campana de la tienda', async () => {
    const { job, eventEmitter } = build({ installments: [installment(1, '2026-12-03', null)] });

    await job.run(NOW);

    expect(emitted(eventEmitter)).toEqual(['POS-1:staff:3']);
  });

  it('solo consulta cuotas pendientes/parciales de órdenes a crédito no canceladas', async () => {
    const { job, db } = build({ installments: [] });

    await job.run(NOW);

    expect(db.order_installments.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        state: { in: ['pending', 'partial'] },
        orders: { store_id: 1, payment_form: '2', state: { not: 'cancelled' } },
      }),
    );
  });
});

describe('addDaysToCivilDate', () => {
  it('cruza fin de mes y de año', () => {
    expect(addDaysToCivilDate(2026, 11, 30, 3)).toBe('2026-12-03');
    expect(addDaysToCivilDate(2026, 12, 30, 3)).toBe('2027-01-02');
    expect(addDaysToCivilDate(2026, 11, 30, 0)).toBe('2026-11-30');
  });
});
