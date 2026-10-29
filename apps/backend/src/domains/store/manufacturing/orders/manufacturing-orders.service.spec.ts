import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ManufacturingOrdersService } from './manufacturing-orders.service';

type Row = Record<string, any>;

describe('ManufacturingOrdersService', () => {
  let prisma: any;
  let tx: any;
  let production: { complete: jest.Mock; computeComponentRequirements: jest.Mock };
  let formulas: { calculateCost: jest.Mock };
  let settings: { get: jest.Mock };
  let sequences: { next: jest.Mock };
  let stockLevelManager: { getDefaultLocationForProduct: jest.Mock };
  let service: ManufacturingOrdersService;
  let order: Row;

  const baseOrder = (over: Row = {}): Row => ({
    id: 1,
    store_id: 1,
    product_id: 50,
    recipe_id: 7,
    order_number: 'OP-000001',
    status: 'draft',
    planned_qty: new Prisma.Decimal(10),
    produced_qty: null,
    actual_cost: null,
    batch_id: null,
    location_id: null,
    product: { id: 50, name: 'Mesa comedor' },
    recipe: { id: 7, code: 'F-1', version: 1 },
    lines: [
      { component_product_id: 99, component_product: { name: 'Madera' } },
    ],
    ...over,
  });

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1, user_id: 42 } as any);

    order = baseOrder();
    tx = {
      production_orders: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      production_order_lines: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      inventory_batches: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 321 }),
        update: jest.fn(),
      },
    };
    prisma = {
      production_orders: {
        findFirst: jest.fn().mockImplementation(async () => order),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      recipes: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          product_id: 50,
          status: 'active',
          is_active: true,
          yield_quantity: 1,
          waste_percent: 0,
          items: [{ component_product_id: 99, quantity: 2, waste_percent: 0 }],
        }),
      },
      stock_levels: { findFirst: jest.fn() },
      inventory_locations: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    production = {
      complete: jest.fn(),
      computeComponentRequirements: jest.fn((_r: unknown, qty: number) => [
        { component_product_id: 99, quantity: qty * 2 },
      ]),
    };
    formulas = { calculateCost: jest.fn().mockResolvedValue({ unit_cost: 50 }) };
    settings = {
      get: jest.fn().mockResolvedValue({
        default_input_location_id: null,
        default_output_location_id: null,
        cost_method: 'fifo',
        lot_required: false,
        wip_account_id: null,
      }),
    };
    sequences = { next: jest.fn().mockResolvedValue('OP-000001') };
    stockLevelManager = { getDefaultLocationForProduct: jest.fn().mockResolvedValue(4) };
    service = new ManufacturingOrdersService(
      prisma,
      production as any,
      formulas as any,
      settings as any,
      sequences as any,
      stockLevelManager as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('crea en borrador con consecutivo, líneas planificadas y costo planificado', async () => {
      await service.create({ recipe_id: 7, planned_qty: 10 });
      expect(sequences.next).toHaveBeenCalledWith(tx, 1);
      const data = tx.production_orders.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        order_number: 'OP-000001',
        status: 'draft',
        product_id: 50,
        source: 'manual',
        created_by: 42,
        priority: 'normal',
      });
      expect(Number(data.planned_cost)).toBe(500); // 50 * 10
      expect(data.lines.create).toHaveLength(1);
      expect(Number(data.lines.create[0].planned_qty)).toBe(20);
    });

    it('rechaza una fórmula que no está activa', async () => {
      prisma.recipes.findFirst.mockResolvedValue({ id: 7, status: 'draft', is_active: false, items: [] });
      await expect(service.create({ recipe_id: 7, planned_qty: 1 })).rejects.toMatchObject({
        errorCode: 'MFG_FORMULA_NOT_ACTIVE',
      });
      expect(sequences.next).not.toHaveBeenCalled();
    });
  });

  describe('transiciones', () => {
    it('draft -> released -> in_progress (con started_at)', async () => {
      await service.release(1);
      expect(prisma.production_orders.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'released' }),
      });
      order = baseOrder({ status: 'released' });
      await service.start(1);
      const data = prisma.production_orders.update.mock.calls.at(-1)[0].data;
      expect(data.status).toBe('in_progress');
      expect(data.started_at).toBeInstanceOf(Date);
    });

    it('no permite iniciar una orden en borrador', async () => {
      await expect(service.start(1)).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_INVALID_STATE',
      });
    });

    it('cancela desde draft, released e in_progress', async () => {
      for (const status of ['draft', 'released', 'in_progress']) {
        order = baseOrder({ status });
        await service.cancel(1);
        expect(prisma.production_orders.update.mock.calls.at(-1)[0].data.status).toBe(
          'cancelled',
        );
      }
    });

    it('rechaza cancelar tras producción parcial y desde completed', async () => {
      order = baseOrder({ status: 'partially_completed' });
      await expect(service.cancel(1)).rejects.toMatchObject({
        errorCode: 'MFG_CANCEL_AFTER_PARTIAL',
      });
      order = baseOrder({ status: 'completed' });
      await expect(service.cancel(1)).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_INVALID_STATE',
      });
      expect(prisma.production_orders.update).not.toHaveBeenCalled();
    });

    it('solo edita en draft o released', async () => {
      order = baseOrder({ status: 'in_progress' });
      await expect(service.update(1, { notes: 'x' })).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_NOT_EDITABLE',
      });
    });

    it('un id inexistente (o de restaurante) devuelve MFG_ORDER_NOT_FOUND', async () => {
      prisma.production_orders.findFirst.mockResolvedValue(null);
      await expect(service.findOne(1)).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_NOT_FOUND',
      });
    });
  });

  describe('complete', () => {
    /** Simula al motor: invoca el hook con un consumo y devuelve sus datos. */
    const runEngine = (total_cost = 40) =>
      production.complete.mockImplementation(async (_id, dto, options) => {
        const data = await options.onProduced(tx, {
          order,
          producedQty: dto.produced_qty,
          producedUnitCost: total_cost / dto.produced_qty,
          totalCost: total_cost,
          consumptions: [
            {
              component_product_id: 99,
              consumed_qty: dto.produced_qty * 2,
              cost_snapshot: { unit_cost: 2, total_cost },
            },
          ],
        });
        return data;
      });

    it('rechaza completar desde draft/released', async () => {
      await expect(service.complete(1, {})).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_INVALID_STATE',
      });
      expect(production.complete).not.toHaveBeenCalled();
    });

    it('completar 4 de 10 deja partially_completed y acumula costo y línea', async () => {
      order = baseOrder({
        status: 'in_progress',
        lines: [{ component_product_id: 99, component_product: { name: 'Madera' } }],
      });
      tx.production_order_lines.findMany.mockResolvedValue([
        { id: 11, component_product_id: 99, consumed_qty: new Prisma.Decimal(0), total_cost: null, cost_snapshot: null },
      ]);
      runEngine(40);

      await service.complete(1, { produced_qty: 4 });

      const [, dto, options] = production.complete.mock.calls[0];
      expect(dto).toEqual({ produced_qty: 4 });
      expect(options).toMatchObject({
        allowPartialBatch: true,
        sourceModule: 'manufacturing',
        costingMethod: 'fifo',
      });
      const line = tx.production_order_lines.update.mock.calls[0][0];
      expect(Number(line.data.consumed_qty)).toBe(8);
      expect(Number(line.data.total_cost)).toBe(40);
      expect(Number(line.data.unit_cost)).toBe(5);

      const hookData = await production.complete.mock.results[0].value;
      expect(hookData.status).toBe('partially_completed');
      expect(Number(hookData.produced_qty)).toBe(4);
      expect(Number(hookData.actual_cost)).toBe(40);
      expect(Number(hookData.unit_cost)).toBe(10);
    });

    it('completar el resto (por defecto) deja completed y acumula', async () => {
      order = baseOrder({
        status: 'partially_completed',
        produced_qty: new Prisma.Decimal(4),
        actual_cost: new Prisma.Decimal(40),
      });
      runEngine(60);

      await service.complete(1, {});

      expect(production.complete.mock.calls[0][1]).toEqual({ produced_qty: 6 });
      const hookData = await production.complete.mock.results[0].value;
      expect(hookData.status).toBe('completed');
      expect(Number(hookData.produced_qty)).toBe(10);
      expect(Number(hookData.actual_cost)).toBe(100);
      expect(Number(hookData.unit_cost)).toBe(10);
    });

    it('rechaza producir más de lo pendiente', async () => {
      order = baseOrder({
        status: 'partially_completed',
        produced_qty: new Prisma.Decimal(8),
      });
      await expect(service.complete(1, { produced_qty: 5 })).rejects.toMatchObject({
        errorCode: 'MFG_QTY_EXCEEDS_REMAINING',
      });
      expect(production.complete).not.toHaveBeenCalled();
    });

    it('rechaza cantidades fraccionarias en vez de redondearlas', async () => {
      order = baseOrder({
        status: 'partially_completed',
        produced_qty: new Prisma.Decimal(9),
      });
      await expect(service.complete(1, { produced_qty: 1.4 })).rejects.toMatchObject({
        errorCode: 'PRODUCTION_INVALID_QTY',
      });
      expect(production.complete).not.toHaveBeenCalled();
    });

    it('rechaza un completado concurrente (la orden cambió en otra operación)', async () => {
      order = baseOrder({ status: 'in_progress' });
      tx.production_orders.updateMany.mockResolvedValue({ count: 0 });
      runEngine(40);

      await expect(service.complete(1, { produced_qty: 4 })).rejects.toMatchObject({
        errorCode: 'MFG_ORDER_CONCURRENT_UPDATE',
      });
      expect(tx.production_orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 1, status: 'in_progress' }),
        }),
      );
      expect(tx.production_order_lines.update).not.toHaveBeenCalled();
    });

    it('crea el lote del terminado cuando lot_required', async () => {
      settings.get.mockResolvedValue({
        default_input_location_id: null,
        default_output_location_id: 8,
        cost_method: 'cpp',
        lot_required: true,
        wip_account_id: null,
      });
      order = baseOrder({ status: 'in_progress' });
      runEngine(10);

      await service.complete(1, { produced_qty: 10, batch: { batch_number: 'L-1' } });

      expect(production.complete.mock.calls[0][2]).toMatchObject({
        outputLocationId: 8,
        costingMethod: 'weighted_average',
      });
      expect(tx.inventory_batches.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          product_id: 50,
          batch_number: 'L-1',
          quantity: 10,
          location_id: 8,
        }),
        select: { id: true },
      });
      const hookData = await production.complete.mock.results[0].value;
      expect(hookData.batch_id).toBe(321);
    });

    it('no crea lote cuando lot_required es false', async () => {
      order = baseOrder({ status: 'in_progress' });
      runEngine(10);
      await service.complete(1, { produced_qty: 10 });
      expect(tx.inventory_batches.create).not.toHaveBeenCalled();
    });
  });

  describe('shortages', () => {
    it('compara lo requerido (con merma/escala) contra quantity_available', async () => {
      order = baseOrder({ status: 'released' });
      prisma.stock_levels.findFirst.mockResolvedValue({ quantity_available: 12 });

      const result = await service.shortages(1);

      expect(production.computeComponentRequirements).toHaveBeenCalledWith(
        expect.anything(),
        10,
      );
      expect(result).toEqual([
        { product_id: 99, name: 'Madera', required: 20, available: 12, missing: 8 },
      ]);
    });

    it('usa la bodega de insumos de la planta y missing=0 si alcanza', async () => {
      settings.get.mockResolvedValue({ default_input_location_id: 5 });
      prisma.stock_levels.findFirst.mockResolvedValue({ quantity_available: 50 });
      const result = await service.shortages(1);
      expect(prisma.stock_levels.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ location_id: 5 }) }),
      );
      expect(stockLevelManager.getDefaultLocationForProduct).not.toHaveBeenCalled();
      expect(result[0].missing).toBe(0);
    });
  });
});
