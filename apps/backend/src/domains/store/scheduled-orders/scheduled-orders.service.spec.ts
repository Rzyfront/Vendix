import { RequestContextService } from '@common/context/request-context.service';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import { ScheduledOrdersService } from './scheduled-orders.service';

const TZ = 'America/Bogota';
const NOW = new Date('2026-11-02T13:00:00.000Z'); // lunes 08:00 local
const SLOT = {
  start: '2026-11-03T15:00:00.000Z', // martes 10:00 local
  end: '2026-11-03T17:00:00.000Z',
};

const settings = {
  scheduled_orders: {
    enabled: true,
    weekly_schedule: [0, 2, 3, 4, 5, 6].map((day_of_week) => ({
      day_of_week,
      start_time: '08:00',
      end_time: '18:00',
    })),
    slot_duration_minutes: 120,
    slot_capacity: 1,
    day_capacity: null,
    min_lead_time_hours: 24,
    max_days_ahead: 30,
    fulfillment_types: ['pickup'],
    reminders: [],
  },
};

interface Row {
  id: number;
  store_id: number;
  order_id: number;
  scheduled_start: Date;
  scheduled_end: Date;
  status: string;
  hold_expires_at: Date | null;
}

/**
 * Base en memoria + advisory lock simulado: `$executeRaw` toma un mutex que se
 * suelta al terminar la "transacción", como `pg_advisory_xact_lock`.
 */
function makeHarness(storeSettings: unknown = settings) {
  const rows: Row[] = [];
  const changes: Array<Record<string, unknown>> = [];
  let lock: Promise<void> = Promise.resolve();

  const schedulesDelegate = {
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter(
        (r) =>
          r.store_id === where.store_id &&
          where.status.in.includes(r.status) &&
          r.scheduled_start >= where.scheduled_start.gte &&
          r.scheduled_start < where.scheduled_start.lt &&
          (!where.id || r.id !== where.id.not),
      ),
    ),
    findUnique: jest.fn(async ({ where }: any) =>
      rows.find((r) => (where.order_id ? r.order_id === where.order_id : r.id === where.id)) ?? null,
    ),
    findFirst: jest.fn(async ({ where }: any) => {
      const row = rows.find((r) => r.id === where.id);
      return row ? { ...row } : null; // Prisma devuelve copias, no referencias
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: rows.length + 1, hold_expires_at: null, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => r.id === where.id && r.status === where.status);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };

  function makeTx(release: { fn?: () => void }) {
    return {
      $executeRaw: jest.fn(async () => {
        const previous = lock;
        let done!: () => void;
        lock = new Promise<void>((resolve) => (done = resolve));
        release.fn = done;
        await previous;
        return 1;
      }),
      order_fulfillment_schedules: schedulesDelegate,
      fulfillment_schedule_exceptions: { findMany: jest.fn(async () => []) },
      order_fulfillment_changes: { create: jest.fn(async ({ data }: any) => changes.push(data)) },
      orders: { update: jest.fn(async () => ({})) },
    };
  }

  async function runInTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const release: { fn?: () => void } = {};
    try {
      return await fn(makeTx(release));
    } finally {
      release.fn?.();
    }
  }

  const prisma: any = {
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: storeSettings, stores: { timezone: TZ } })),
    },
    order_fulfillment_schedules: schedulesDelegate,
    fulfillment_schedule_exceptions: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn((fn: any) => runInTx(fn)),
    withoutScope: () => prisma,
  };

  const events = { emit: jest.fn() };
  const availability = new FulfillmentAvailabilityService(prisma);
  const service = new ScheduledOrdersService(prisma, availability, events as any);
  return { service, rows, changes, events, runInTx, schedulesDelegate };
}

/** Applies a Prisma-like `select` (recursively) so a missing field in the query is missing in the result. */
function applySelect(value: any, select: any): any {
  if (Array.isArray(value)) return value.map((v) => applySelect(v, select));
  if (!select || value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, sel] of Object.entries(select)) {
    if (!sel) continue;
    out[key] = sel === true ? value[key] : applySelect(value[key], (sel as any).select);
  }
  return out;
}

const FULL_ORDER = {
  id: 50,
  order_number: 'ORD-50',
  grand_total: 120000,
  state: 'processing',
  customer_id: 7,
  customer_alias: null,
  users: { first_name: 'Valentina', last_name: 'Ríos', phone: '3001112233', email: 'v@x.co' },
  order_items: [
    {
      id: 1,
      product_name: 'Torta mediana',
      variant_attributes: null,
      quantity: 1,
      notes: 'Dedicatoria: Feliz cumpleaños, Sofía',
      fulfillment_destination: 'production',
      product_id: 77,
      products: { product_type: 'prepared', is_batch_produced: true, _count: { recipes: 1 } },
      order_item_options: [
        { group_name: 'Relleno', option_name: 'Ganache', quantity: 1, uom: 'unit', scope: 'per_line' },
        { group_name: 'Fruta', option_name: 'Fresas', quantity: 1, uom: 'unit', scope: 'per_line', note: 'solo encima, en corona' },
        { group_name: 'Extras', option_name: 'Vela', quantity: 1, uom: 'unit', scope: 'per_line' },
      ],
    },
  ],
};

describe('ScheduledOrdersService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      user_id: 9,
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('createForOrder', () => {
    it('crea el agendamiento en estado scheduled con su historial', async () => {
      const { service, rows, changes, runInTx } = makeHarness();
      await runInTx((tx) =>
        service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, user_id: 9, now: NOW }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ order_id: 50, status: 'scheduled', fulfillment_type: 'pickup' });
      expect(changes[0]).toMatchObject({ change_type: 'created', to_status: 'scheduled' });
    });

    it('con el ajuste apagado rechaza con SCHED_DISABLED', async () => {
      const { service, runInTx } = makeHarness({});
      await expect(
        runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW })),
      ).rejects.toMatchObject({ errorCode: 'SCHED_DISABLED' });
    });

    it('rechaza un tipo de cumplimiento que la tienda no ofrece', async () => {
      const { service, runInTx } = makeHarness();
      await expect(
        runInTx((tx) =>
          service.createForOrder(tx, {
            store_id: 1,
            order_id: 50,
            schedule: { ...SLOT, fulfillment_type: 'delivery' },
            now: NOW,
          }),
        ),
      ).rejects.toMatchObject({ errorCode: 'SCHED_FULFILLMENT_TYPE' });
    });

    it('dos ventas concurrentes por el último cupo: una pasa, la otra recibe SCHED_SLOT_FULL', async () => {
      const { service, rows, runInTx } = makeHarness();
      const results = await Promise.allSettled([
        runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 51, schedule: SLOT, now: NOW })),
        runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 52, schedule: SLOT, now: NOW })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({
        errorCode: 'SCHED_SLOT_FULL',
        message: 'No hay cupo en esa franja. Elige otra hora.',
      });
      expect(rows).toHaveLength(1);
    });

    it('una orden no puede agendarse dos veces', async () => {
      const { service, runInTx } = makeHarness({
        scheduled_orders: { ...settings.scheduled_orders, slot_capacity: 5 },
      });
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }));
      await expect(
        runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW })),
      ).rejects.toMatchObject({ errorCode: 'SCHED_ALREADY_SCHEDULED' });
    });
  });

  describe('transition', () => {
    async function seeded() {
      const harness = makeHarness();
      await harness.runInTx((tx) =>
        harness.service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }),
      );
      return harness;
    }

    it('sigue scheduled → in_production → ready → delivered sellando cada fecha', async () => {
      const { service, rows, changes } = await seeded();
      await service.transition(1, 'in_production');
      await service.transition(1, 'ready');
      await service.transition(1, 'delivered');
      expect(rows[0].status).toBe('delivered');
      expect(rows[0]).toHaveProperty('produced_at');
      expect(rows[0]).toHaveProperty('delivered_at');
      expect(changes.filter((c) => c.change_type === 'status').map((c) => c.to_status)).toEqual([
        'in_production', 'ready', 'delivered',
      ]);
    });

    it('rechaza saltos no permitidos (scheduled → delivered)', async () => {
      const { service } = await seeded();
      await expect(service.transition(1, 'delivered')).rejects.toMatchObject({
        errorCode: 'SCHED_INVALID_TRANSITION',
      });
    });

    it('no_show solo cuando la franja ya pasó', async () => {
      const { service, rows } = await seeded();
      await service.transition(1, 'in_production');
      await service.transition(1, 'ready');
      await expect(
        service.transition(1, 'no_show', undefined, new Date('2026-11-03T16:00:00.000Z')),
      ).rejects.toMatchObject({ errorCode: 'SCHED_INVALID_TRANSITION' });
      await service.transition(1, 'no_show', undefined, new Date('2026-11-03T18:00:00.000Z'));
      expect(rows[0].status).toBe('no_show');
    });

    it('QUI-1000: transitionInTx usa la transacción del llamador, corre el gancho y valida igual', async () => {
      const harness = await seeded();
      const { service, rows } = harness;
      const hook = jest.fn(async () => undefined);
      service.registerProductionStartHook(hook);
      await expect(
        harness.runInTx((tx) => service.transitionInTx(tx, 1, 'delivered', [])),
      ).rejects.toMatchObject({ errorCode: 'SCHED_INVALID_TRANSITION' });
      await harness.runInTx((tx) => service.transitionInTx(tx, 1, 'in_production', []));
      expect(hook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 1, order_id: 50 }));
      expect(rows[0].status).toBe('in_production');
    });

    it('in_production ejecuta el gancho de producción dentro de la transacción', async () => {
      const { service } = await seeded();
      const hook = jest.fn(async () => undefined);
      service.registerProductionStartHook(hook);
      await service.transition(1, 'in_production');
      expect(hook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 1, order_id: 50 }));
    });

    it('cancelar después de producir no revierte (sin gancho de reversa) y libera la franja', async () => {
      const { service, rows } = await seeded();
      await service.transition(1, 'in_production');
      await service.cancelForOrder(50);
      expect(rows[0].status).toBe('cancelled');
    });
  });

  describe('reschedule', () => {
    it('mueve a una franja con cupo, deja historial de → a por usuario y emite el evento', async () => {
      const { service, rows, changes, events, runInTx } = makeHarness();
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }));
      await service.reschedule(
        1,
        { start: '2026-11-03T17:00:00.000Z', end: '2026-11-03T19:00:00.000Z' },
        NOW,
      );
      expect(rows[0].scheduled_start.toISOString()).toBe('2026-11-03T17:00:00.000Z');
      expect(changes.at(-1)).toMatchObject({
        change_type: 'reschedule',
        from_start: new Date(SLOT.start),
        to_start: new Date('2026-11-03T17:00:00.000Z'),
        changed_by_user_id: 9,
      });
      expect(events.emit).toHaveBeenCalledWith(
        'scheduled_order.rescheduled',
        expect.objectContaining({ schedule_id: 1, order_id: 50 }),
      );
    });

    it('a una franja llena no se mueve y devuelve SCHED_SLOT_FULL', async () => {
      const { service, rows, runInTx } = makeHarness();
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }));
      const other = { start: '2026-11-03T17:00:00.000Z', end: '2026-11-03T19:00:00.000Z' };
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 51, schedule: other, now: NOW }));
      await expect(service.reschedule(1, other, NOW)).rejects.toMatchObject({ errorCode: 'SCHED_SLOT_FULL' });
      expect(rows[0].scheduled_start.toISOString()).toBe(SLOT.start);
    });

    it('si otro usuario cambió el estado mientras tanto, no reprograma y devuelve SCHED_INVALID_TRANSITION', async () => {
      const { service, rows, changes, schedulesDelegate, runInTx } = makeHarness();
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }));
      // Lectura previa con el estado viejo; en base ya se entregó.
      schedulesDelegate.findFirst.mockResolvedValueOnce({ ...rows[0] });
      rows[0].status = 'delivered';
      const before = changes.length;
      await expect(
        service.reschedule(1, { start: '2026-11-03T17:00:00.000Z', end: '2026-11-03T19:00:00.000Z' }, NOW),
      ).rejects.toMatchObject({ errorCode: 'SCHED_INVALID_TRANSITION' });
      expect(rows[0].scheduled_start.toISOString()).toBe(SLOT.start);
      expect(changes.length).toBe(before);
    });

    it('reprogramar a la misma franja no choca consigo mismo', async () => {
      const { service, runInTx } = makeHarness();
      await runInTx((tx) => service.createForOrder(tx, { store_id: 1, order_id: 50, schedule: SLOT, now: NOW }));
      await expect(service.reschedule(1, SLOT, NOW)).resolves.toBeTruthy();
    });
  });
  describe('findOne (QUI-991)', () => {
    it('devuelve la clienta, los productos con adiciones y la nota de cada línea', async () => {
      const { service, rows } = makeHarness();
      rows.push({
        id: 1, store_id: 1, order_id: 50,
        scheduled_start: new Date(SLOT.start), scheduled_end: new Date(SLOT.end),
        status: 'scheduled', hold_expires_at: null,
      });
      const prisma: any = (service as any).prisma;
      const original = prisma.order_fulfillment_schedules.findFirst;
      prisma.order_fulfillment_schedules.findFirst = jest.fn(async (args: any) => {
        const base = await original(args);
        if (!base || !args.include) return base;
        return { ...base, changes: [], order: applySelect(FULL_ORDER, args.include.order.select) };
      });
      prisma.order_items = { count: jest.fn(async () => 0) };

      const detail: any = await service.findOne(1);

      expect(detail.order.users).toMatchObject({ first_name: 'Valentina', last_name: 'Ríos' });
      expect(detail.order.order_items).toHaveLength(1);
      expect(detail.order.order_items[0].notes).toBe('Dedicatoria: Feliz cumpleaños, Sofía');
      expect(detail.order.order_items[0].order_item_options.map((o: any) => o.option_name)).toEqual([
        'Ganache',
        'Fresas',
        'Vela',
      ]);
      expect(detail.order.order_items[0].order_item_options[1].note).toBe('solo encima, en corona');
      expect(detail.order.customer_alias).toBeNull();
      expect(detail.pending_kitchen_item_count).toBe(0);
    });

    it('QUI-999: cada línea expone destino, product_id, product_type e is_producible', async () => {
      const { service, rows } = makeHarness();
      rows.push({
        id: 1, store_id: 1, order_id: 50,
        scheduled_start: new Date(SLOT.start), scheduled_end: new Date(SLOT.end),
        status: 'scheduled', hold_expires_at: null,
      });
      const prisma: any = (service as any).prisma;
      const original = prisma.order_fulfillment_schedules.findFirst;
      prisma.order_fulfillment_schedules.findFirst = jest.fn(async (args: any) => {
        const base = await original(args);
        if (!base || !args.include) return base;
        return { ...base, changes: [], order: applySelect(FULL_ORDER, args.include.order.select) };
      });
      prisma.order_items = { count: jest.fn(async () => 0) };

      const detail: any = await service.findOne(1);
      const line = detail.order.order_items[0];

      expect(line).toMatchObject({
        fulfillment_destination: 'production',
        product_id: 77,
        product_type: 'prepared',
        is_producible: true,
      });
      expect(line).not.toHaveProperty('products');
      // No linked production order yet → explicit null.
      expect(line.production_order).toBeNull();
    });

    it('QUI-995: a production line exposes its linked production order; the order hides the raw relation', async () => {
      const { service, rows } = makeHarness();
      rows.push({
        id: 1, store_id: 1, order_id: 50,
        scheduled_start: new Date(SLOT.start), scheduled_end: new Date(SLOT.end),
        status: 'scheduled', hold_expires_at: null,
      });
      const withLink = {
        ...FULL_ORDER,
        production_orders: [{ id: 900, product_id: 77, order_number: 'OP-000900', status: 'in_progress' }],
      };
      const prisma: any = (service as any).prisma;
      const original = prisma.order_fulfillment_schedules.findFirst;
      prisma.order_fulfillment_schedules.findFirst = jest.fn(async (args: any) => {
        const base = await original(args);
        if (!base || !args.include) return base;
        return { ...base, changes: [], order: applySelect(withLink, args.include.order.select) };
      });
      prisma.order_items = { count: jest.fn(async () => 0) };

      const detail: any = await service.findOne(1);

      expect(detail.order.order_items[0].production_order).toEqual({
        id: 900,
        order_number: 'OP-000900',
        status: 'in_progress',
      });
      expect(detail.order).not.toHaveProperty('production_orders');
    });
  });
});
