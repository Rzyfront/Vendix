import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from './production-orders.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * QUI-1002 — Producción activa (backend): saved start time, per-order estimated
 * time, one card per sale (start/complete move every order) and the
 * `production_order.updated` live-sync event emitted after commit.
 */
describe('ProductionOrdersService — Producción activa (QUI-1002)', () => {
  let prisma: any;
  let emitter: { emit: jest.Mock };
  let service: ProductionOrdersService;

  const order = (over: Record<string, unknown> = {}) => ({
    id: 5,
    store_id: 1,
    order_id: null,
    status: 'draft',
    started_at: null,
    produced_at: null,
    estimated_minutes: null,
    product_id: 50,
    recipe_id: 7,
    planned_qty: new Prisma.Decimal(3),
    produced_qty: null,
    product: { id: 50, name: 'Torta', preparation_time_minutes: 40 },
    recipe: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      production_orders: {
        findFirst: jest.fn().mockResolvedValue(order()),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      production_order_lines: { findMany: jest.fn().mockResolvedValue([]) },
      products: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      recipes: { findFirst: jest.fn() },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
      },
    };
    emitter = { emit: jest.fn() };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 9 } as any);
    service = new ProductionOrdersService(prisma, {} as any, {} as any, emitter as any);
  });

  afterEach(() => jest.restoreAllMocks());

  const updatedEvents = () =>
    emitter.emit.mock.calls.filter((c) => c[0] === 'production_order.updated').map((c) => c[1]);

  describe('start()', () => {
    it('saves started_at together with in_progress through an atomic draft claim, then emits', async () => {
      prisma.production_orders.findFirst
        .mockResolvedValueOnce(order())
        .mockResolvedValueOnce(order({ status: 'in_progress', started_at: new Date('2026-11-10T15:00:00Z') }));
      jest.useFakeTimers().setSystemTime(new Date('2026-11-10T15:00:00Z'));

      const result = await service.start(5);

      expect(prisma.production_orders.updateMany).toHaveBeenCalledWith({
        where: { id: 5, status: 'draft' },
        data: {
          status: 'in_progress',
          started_at: new Date('2026-11-10T15:00:00Z'),
          updated_at: new Date('2026-11-10T15:00:00Z'),
        },
      });
      expect(result.status).toBe('in_progress');
      expect(updatedEvents()).toEqual([
        expect.objectContaining({
          type: 'production_order.updated',
          store_id: 1,
          id: 5,
          status: 'in_progress',
          started_at: '2026-11-10T15:00:00.000Z',
        }),
      ]);
      jest.useRealTimers();
    });

    it('a lost claim (count 0) raises the same invalid-transition error and emits nothing', async () => {
      prisma.production_orders.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.start(5)).rejects.toMatchObject({ errorCode: 'PRODUCTION_ORDER_INVALID_STATE' });
      expect(updatedEvents()).toEqual([]);
    });

    it('still rejects a non-draft order without touching it (previous behavior)', async () => {
      prisma.production_orders.findFirst.mockResolvedValue(order({ status: 'in_progress' }));
      await expect(service.start(5)).rejects.toMatchObject({ errorCode: 'PRODUCTION_ORDER_INVALID_STATE' });
      expect(prisma.production_orders.updateMany).not.toHaveBeenCalled();
      expect(prisma.production_orders.update).not.toHaveBeenCalled();
    });

    it('an emission failure never breaks the start', async () => {
      emitter.emit.mockImplementation(() => {
        throw new Error('bus down');
      });
      await expect(service.start(5)).resolves.toBeDefined();
    });
  });

  describe('update() — estimated_minutes', () => {
    it('persists the override and emits the edited order', async () => {
      prisma.production_orders.update.mockResolvedValue(order({ estimated_minutes: 25 }));
      await service.update(5, { estimated_minutes: 25 } as any);
      expect(prisma.production_orders.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({ estimated_minutes: 25 }),
      });
      expect(updatedEvents()).toEqual([
        expect.objectContaining({ id: 5, status: 'draft', estimated_minutes: 25 }),
      ]);
    });

    it('null clears the override', async () => {
      prisma.production_orders.update.mockResolvedValue(order());
      await service.update(5, { estimated_minutes: null } as any);
      expect(prisma.production_orders.update.mock.calls[0][0].data.estimated_minutes).toBeNull();
    });

    it('does not write the field when it is omitted (previous behavior)', async () => {
      prisma.production_orders.update.mockResolvedValue(order());
      await service.update(5, {} as any);
      expect(prisma.production_orders.update.mock.calls[0][0].data).not.toHaveProperty('estimated_minutes');
    });

    it('still rejects a completed order', async () => {
      prisma.production_orders.findFirst.mockResolvedValue(order({ status: 'completed' }));
      await expect(service.update(5, { estimated_minutes: 5 } as any)).rejects.toMatchObject({
        errorCode: 'PRODUCTION_ORDER_INVALID_STATE',
      });
      expect(prisma.production_orders.update).not.toHaveBeenCalled();
    });
  });

  describe('create() / cancel() emit', () => {
    it('create emits the new order after the insert', async () => {
      prisma.products.findFirst.mockResolvedValue({ id: 50, name: 'Salsa', product_type: 'physical', is_batch_produced: true, store_id: 1 });
      prisma.recipes.findFirst.mockResolvedValue({ id: 7, product_id: 50, is_active: true, yield_quantity: 1, yield_unit: 'unit', waste_percent: 0, items: [] });
      prisma.production_orders.create.mockResolvedValue(order({ id: 8 }));
      await service.create({ product_id: 50, recipe_id: 7, planned_qty: 3 } as any);
      expect(updatedEvents()).toEqual([expect.objectContaining({ id: 8, status: 'draft', store_id: 1 })]);
    });

    it('cancel emits the cancelled order; an already cancelled one stays idempotent and silent', async () => {
      // cancel() reclama con updateMany atómico y relee la orden (findOne).
      prisma.production_orders.updateMany.mockResolvedValue({ count: 1 });
      prisma.production_orders.findFirst
        .mockResolvedValueOnce(order({ status: 'draft' }))
        .mockResolvedValueOnce(order({ status: 'cancelled' }));
      await service.cancel(5);
      expect(prisma.production_orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 5 }),
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
      expect(updatedEvents()).toEqual([expect.objectContaining({ id: 5, status: 'cancelled' })]);

      emitter.emit.mockClear();
      prisma.production_orders.findFirst.mockResolvedValue(order({ status: 'cancelled' }));
      await service.cancel(5);
      expect(updatedEvents()).toEqual([]);
    });
  });

  describe('estimated time on reads', () => {
    const dayRow = (over: Record<string, unknown>) => ({
      id: 1,
      order_number: 'OP-1',
      status: 'draft',
      source: 'manual',
      product_id: 50,
      planned_qty: new Prisma.Decimal(1),
      produced_qty: null,
      started_at: null,
      produced_at: null,
      due_date: null,
      created_at: new Date('2026-11-10T15:00:00Z'),
      order_id: null,
      estimated_minutes: null,
      product: { name: 'Torta', preparation_time_minutes: null },
      sale_order: null,
      ...over,
    });

    it('findDay: the override wins, falls back to the product preparation time, null when neither', async () => {
      prisma.production_orders.findMany.mockResolvedValue([
        dayRow({ id: 1, estimated_minutes: 15, product: { name: 'A', preparation_time_minutes: 40 } }),
        dayRow({ id: 2, estimated_minutes: null, product: { name: 'B', preparation_time_minutes: 40 } }),
        dayRow({ id: 3, estimated_minutes: null, product: { name: 'C', preparation_time_minutes: null } }),
        dayRow({ id: 4, estimated_minutes: 0, product: { name: 'D', preparation_time_minutes: 40 } }),
      ]);
      const result = await service.findDay({ date: '2026-11-10' });
      const byId = Object.fromEntries(
        result.cards.flatMap((c) => c.production_orders).map((o) => [o.id, o]),
      );
      expect(byId[1]).toMatchObject({ estimated_minutes: 15, effective_estimated_minutes: 15 });
      expect(byId[2]).toMatchObject({ estimated_minutes: null, effective_estimated_minutes: 40 });
      expect(byId[3]).toMatchObject({ estimated_minutes: null, effective_estimated_minutes: null });
      expect(byId[4]).toMatchObject({ estimated_minutes: 0, effective_estimated_minutes: 0 });
      const select = prisma.production_orders.findMany.mock.calls[0][0].select;
      expect(select.estimated_minutes).toBe(true);
      expect(select.product.select.preparation_time_minutes).toBe(true);
    });

    it('findOne asks for the preparation time and returns both values', async () => {
      const found = await service.findOne(5);
      const include = prisma.production_orders.findFirst.mock.calls[0][0].include;
      expect(include.product.select.preparation_time_minutes).toBe(true);
      expect(found).toMatchObject({ estimated_minutes: null, effective_estimated_minutes: 40 });
    });

    it('getDetail returns both values', async () => {
      const detail = await service.getDetail(5);
      expect(detail).toMatchObject({ estimated_minutes: null, effective_estimated_minutes: 40 });
    });
  });

  describe('sale card: startSale / completeSale', () => {
    const rows = [
      { id: 1, status: 'draft', planned_qty: new Prisma.Decimal(2) },
      { id: 2, status: 'in_progress', planned_qty: new Prisma.Decimal(3) },
      { id: 3, status: 'draft', planned_qty: new Prisma.Decimal(1) },
      { id: 4, status: 'completed', planned_qty: new Prisma.Decimal(1) },
    ];

    beforeEach(() => {
      prisma.production_orders.findMany.mockResolvedValue(rows);
    });

    it('startSale moves only draft orders of the sale through start(id); others are skipped', async () => {
      const start = jest.spyOn(service, 'start').mockResolvedValue({} as any);
      const result = await service.startSale(77);
      expect(prisma.production_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { order_id: 77, store_id: 1 } }),
      );
      expect(start.mock.calls.map((c) => c[0])).toEqual([1, 3]);
      expect(result).toEqual({ moved: [1, 3], skipped: [2, 4], failed: [] });
    });

    it('startSale reports an order that throws and keeps moving the others', async () => {
      jest
        .spyOn(service, 'start')
        .mockRejectedValueOnce(new Error('claim lost'))
        .mockResolvedValueOnce({} as any);
      const result = await service.startSale(77);
      expect(result).toEqual({
        moved: [3],
        skipped: [2, 4],
        failed: [{ id: 1, message: 'claim lost' }],
      });
    });

    it('completeSale completes only in_progress orders with produced_qty = planned_qty', async () => {
      const complete = jest.spyOn(service, 'complete').mockResolvedValue({} as any);
      const result = await service.completeSale(77);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledWith(2, { produced_qty: 3 });
      expect(result).toEqual({ moved: [2], skipped: [1, 3, 4], failed: [] });
    });

    it('S19: completeSale con todas las órdenes fallidas responde error con los motivos', async () => {
      jest.spyOn(service, 'complete').mockRejectedValue(new Error('sin stock'));
      await expect(service.completeSale(77)).rejects.toMatchObject({
        errorCode: 'PRODUCTION_SALE_MOVE_FAILED',
        response: {
          error_code: 'PRODUCTION_SALE_MOVE_FAILED',
          message: 'sin stock',
          details: {
            action: 'complete',
            failed: [{ id: 2, message: 'sin stock' }],
            skipped: [1, 3, 4],
          },
        },
      });
    });

    it('S19: startSale con todas las órdenes fallidas responde error con los motivos de cada una', async () => {
      jest
        .spyOn(service, 'start')
        .mockRejectedValueOnce(new Error('claim lost'))
        .mockRejectedValueOnce(new Error('sin insumos'));
      await expect(service.startSale(77)).rejects.toMatchObject({
        errorCode: 'PRODUCTION_SALE_MOVE_FAILED',
        response: {
          message: 'claim lost · sin insumos',
          details: {
            action: 'start',
            failed: [
              { id: 1, message: 'claim lost' },
              { id: 3, message: 'sin insumos' },
            ],
          },
        },
      });
    });

    it('S19: sin órdenes por mover y sin fallas (todas saltadas) responde como siempre', async () => {
      prisma.production_orders.findMany.mockResolvedValue([
        { id: 4, status: 'completed', planned_qty: new Prisma.Decimal(1) },
      ]);
      expect(await service.completeSale(77)).toEqual({ moved: [], skipped: [4], failed: [] });
    });

    it('a sale without production orders returns empty lists', async () => {
      prisma.production_orders.findMany.mockResolvedValue([]);
      expect(await service.startSale(99)).toEqual({ moved: [], skipped: [], failed: [] });
    });
  });
});
