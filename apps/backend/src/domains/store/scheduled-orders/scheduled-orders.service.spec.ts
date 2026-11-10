import { RequestContextService } from '@common/context/request-context.service';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import {
  ScheduledOrdersService,
  deriveFulfillmentDisplayStatus,
  kitchenPendingItemsWhere,
} from './scheduled-orders.service';

/**
 * S28 — `order_items.count` answers only for the exact pending-kitchen filter of
 * the order under test; any other filter reads as 0 and fails the assertion.
 */
const countFor = (n: number, order_id = 50, store_id = 1) =>
  jest.fn(async ({ where }: any) =>
    JSON.stringify(where) === JSON.stringify(kitchenPendingItemsWhere(order_id, store_id)) ? n : 0,
  );

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
      findFirst: jest.fn(async () => ({ settings: storeSettings, stores: { timezone: TZ, industries: ['restaurant'] } })),
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
      prisma.order_items = { count: countFor(0) };

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
      prisma.order_items = { count: countFor(0) };

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
      prisma.order_items = { count: countFor(0) };

      const detail: any = await service.findOne(1);

      expect(detail.order.order_items[0].production_order).toEqual({
        id: 900,
        order_number: 'OP-000900',
        status: 'in_progress',
      });
      expect(detail.order).not.toHaveProperty('production_orders');
    });

    it('QUI-995 B2: two variants of one product each expose THEIR OWN production order', async () => {
      const { service, rows } = makeHarness();
      rows.push({
        id: 1, store_id: 1, order_id: 50,
        scheduled_start: new Date(SLOT.start), scheduled_end: new Date(SLOT.end),
        status: 'scheduled', hold_expires_at: null,
      });
      const [first] = FULL_ORDER.order_items;
      const twoVariants = {
        ...FULL_ORDER,
        order_items: [
          { ...first, id: 1, product_variant_id: 10 },
          { ...first, id: 2, product_variant_id: 11 },
        ],
        production_orders: [
          { id: 900, product_id: 77, product_variant_id: 10, order_number: 'OP-000900', status: 'completed' },
          { id: 901, product_id: 77, product_variant_id: 11, order_number: 'OP-000901', status: 'draft' },
        ],
      };
      const prisma: any = (service as any).prisma;
      const original = prisma.order_fulfillment_schedules.findFirst;
      prisma.order_fulfillment_schedules.findFirst = jest.fn(async (args: any) => {
        const base = await original(args);
        if (!base || !args.include) return base;
        return { ...base, changes: [], order: applySelect(twoVariants, args.include.order.select) };
      });
      prisma.order_items = { count: countFor(0) };

      const detail: any = await service.findOne(1);

      expect(detail.order.order_items.map((l: any) => l.production_order?.id)).toEqual([900, 901]);
    });
  });

  describe('deriveFulfillmentDisplayStatus (S23)', () => {
    const NOW_D = new Date('2026-11-03T12:00:00.000Z');
    const FUTURE_END = new Date('2026-11-03T17:00:00.000Z');
    const PAST_END = new Date('2026-11-03T10:00:00.000Z');
    const base = {
      stored_status: 'scheduled',
      produced_at: null as Date | null,
      scheduled_end: FUTURE_END,
      order_state: 'processing',
      production_statuses: [] as string[],
      pending_kitchen_count: 0,
    };
    const derive = (over: Partial<typeof base>) =>
      deriveFulfillmentDisplayStatus({ ...base, ...over }, NOW_D);

    it('cancelled when the sale is cancelled, even with finished production', () => {
      expect(derive({ order_state: 'cancelled', production_statuses: ['completed'] })).toBe('cancelled');
    });
    it('cancelled when the sale is refunded', () => {
      expect(derive({ order_state: 'refunded', production_statuses: ['in_progress'] })).toBe('cancelled');
    });
    it('cancelled when the stored schedule was cancelled (cancelForOrder)', () => {
      expect(derive({ stored_status: 'cancelled' })).toBe('cancelled');
    });
    it('delivered when the sale is finished or delivered', () => {
      expect(derive({ order_state: 'finished', scheduled_end: PAST_END })).toBe('delivered');
      expect(derive({ order_state: 'delivered' })).toBe('delivered');
    });
    it('ready when every linked production order is completed and nothing is pending for the kitchen', () => {
      expect(derive({ production_statuses: ['completed', 'completed'] })).toBe('ready');
    });
    it('production completed but dishes still pending for the kitchen is in_production, not ready', () => {
      expect(derive({ production_statuses: ['completed'], pending_kitchen_count: 2 })).toBe('in_production');
    });
    it('in_production when production started (in_progress / partially_completed / partly completed)', () => {
      expect(derive({ production_statuses: ['in_progress'] })).toBe('in_production');
      expect(derive({ production_statuses: ['partially_completed'] })).toBe('in_production');
      expect(derive({ production_statuses: ['completed', 'draft'] })).toBe('in_production');
    });
    it('in_production when the order was sent to the kitchen (produced_at set)', () => {
      expect(derive({ produced_at: new Date('2026-11-03T09:00:00.000Z') })).toBe('in_production');
    });
    it('scheduled when nothing started, nothing was sent and production is only draft', () => {
      expect(derive({})).toBe('scheduled');
      expect(derive({ production_statuses: ['draft'] })).toBe('scheduled');
    });
    it('expired (not no_show) when the slot passed without delivery and the sale is open', () => {
      expect(derive({ scheduled_end: PAST_END })).toBe('expired');
      expect(derive({ scheduled_end: PAST_END, stored_status: 'no_show' })).toBe('expired');
      expect(derive({ scheduled_end: PAST_END, production_statuses: ['completed'] })).toBe('expired');
    });
    it('a cancelled sale past its slot stays cancelled, not expired', () => {
      expect(derive({ scheduled_end: PAST_END, order_state: 'cancelled' })).toBe('cancelled');
    });
  });

  describe('kitchenPendingItemsWhere', () => {
    it('keeps the single-order predicate', () => {
      expect(kitchenPendingItemsWhere(5, 1)).toMatchObject({
        order_id: 5,
        orders: { store_id: 1 },
        cancelled_at: null,
        skip_kds: false,
        inventory_consumed_at_fire: false,
        inventory_committed: false,
      });
    });
    it('accepts many orders for one batched read', () => {
      expect(kitchenPendingItemsWhere([5, 6], 1)).toMatchObject({
        order_id: { in: [5, 6] },
        orders: { store_id: 1 },
        products: { product_type: 'prepared', is_batch_produced: false },
      });
    });
  });

  describe('getAgenda / findOne derived display_status (S23)', () => {
    const row = (id: number, order_id: number, extra: Record<string, unknown> = {}) => ({
      id,
      store_id: 1,
      order_id,
      scheduled_start: new Date('2999-11-03T15:00:00.000Z'),
      scheduled_end: new Date('2999-11-03T17:00:00.000Z'),
      status: 'scheduled',
      produced_at: null,
      order: { ...FULL_ORDER, id: order_id, state: 'processing', production_orders: [] },
      ...extra,
    });

    function agendaHarness(rows: any[], pendingByOrder: Record<number, number>) {
      const { service } = makeHarness();
      const prisma: any = (service as any).prisma;
      prisma.order_fulfillment_schedules.findMany = jest.fn(async () => rows);
      prisma.order_items = {
        groupBy: jest.fn(async () =>
          Object.entries(pendingByOrder).map(([order_id, n]) => ({ order_id: Number(order_id), _count: { _all: n } })),
        ),
      };
      prisma.store_settings.findFirst = jest.fn(async () => ({ settings: {}, stores: { timezone: TZ } }));
      return { service, prisma };
    }

    it('adds display_status per row from the sale, its production and the kitchen, with ONE batched pending read', async () => {
      const rows = [
        row(1, 50, { order: { ...row(1, 50).order, state: 'cancelled' } }),
        row(2, 51, { order: { ...row(2, 51).order, state: 'finished' } }),
        row(3, 52, { order: { ...row(3, 52).order, production_orders: [{ id: 9, product_id: 77, product_variant_id: null, order_number: 'OP-9', status: 'completed' }] } }),
        row(4, 53, { produced_at: new Date() }),
        row(5, 54),
        row(6, 55, { scheduled_end: new Date('2000-01-01T00:00:00.000Z') }),
      ];
      const { service, prisma } = agendaHarness(rows, { 53: 1 });

      const agenda: any[] = await service.getAgenda({ from: '2999-11-03', to: '2999-11-03' });

      expect(agenda.map((r) => r.display_status)).toEqual([
        'cancelled', 'delivered', 'ready', 'in_production', 'scheduled', 'expired',
      ]);
      expect(prisma.order_items.groupBy).toHaveBeenCalledTimes(1);
      expect(agenda[0].status).toBe('scheduled'); // stored status untouched
    });

    it('filters by the derived status, not by the stored one', async () => {
      const rows = [row(1, 50), row(2, 51, { order: { ...row(2, 51).order, state: 'finished' } })];
      const { service, prisma } = agendaHarness(rows, {});

      const agenda: any[] = await service.getAgenda({ from: '2999-11-03', to: '2999-11-03', status: 'delivered' });

      expect(agenda.map((r) => r.id)).toEqual([2]);
      // the status filter is applied after deriving, so the DB read does not narrow by stored status
      expect(prisma.order_fulfillment_schedules.findMany.mock.calls[0][0].where.status).toBeUndefined();
    });

    it('findOne exposes display_status and keeps pending_kitchen_item_count', async () => {
      const { service, rows } = makeHarness();
      rows.push({
        id: 1, store_id: 1, order_id: 50,
        scheduled_start: new Date(SLOT.start), scheduled_end: new Date('2999-01-01T00:00:00.000Z'),
        status: 'scheduled', hold_expires_at: null,
      });
      const prisma: any = (service as any).prisma;
      const original = prisma.order_fulfillment_schedules.findFirst;
      prisma.order_fulfillment_schedules.findFirst = jest.fn(async (args: any) => {
        const base = await original(args);
        if (!base || !args.include) return base;
        return { ...base, changes: [], order: applySelect({ ...FULL_ORDER, production_orders: [] }, args.include.order.select) };
      });
      prisma.order_items = { count: countFor(2) };

      const detail: any = await service.findOne(1);

      expect(detail.pending_kitchen_item_count).toBe(2);
      expect(detail.display_status).toBe('scheduled');
    });
  });
});
