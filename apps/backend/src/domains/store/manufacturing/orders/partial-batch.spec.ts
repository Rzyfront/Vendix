import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from '../../production/production-orders.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

/**
 * `allowPartialBatch` permite producir cantidades que no son múltiplo exacto
 * del rendimiento; sin la opción el motor (restaurante) sigue exigiendo tandas
 * enteras.
 */
describe('ProductionOrdersService.complete — allowPartialBatch', () => {
  let service: ProductionOrdersService;
  let stock: { updateStock: jest.Mock; getDefaultLocationForProduct: jest.Mock };
  let prisma: any;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1, user_id: 42 } as any);
    stock = {
      updateStock: jest.fn().mockResolvedValue({
        cost_snapshot: { unit_cost: 2, total_cost: 8, stock_value: 0 },
      }),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
    };
    const order = {
      id: 5,
      store_id: 1,
      product_id: 50,
      status: 'in_progress',
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      product: { id: 50, name: 'Mesa', sku: 'M', stock_unit: 'u', is_batch_produced: true },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'u',
        waste_percent: new Prisma.Decimal(0),
        items: [
          {
            component_product_id: 99,
            quantity: new Prisma.Decimal(10),
            waste_percent: new Prisma.Decimal(0),
            component_product: { id: 99, name: 'Madera' },
          },
        ],
      },
    };
    prisma = {
      production_orders: { findFirst: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          production_orders: {
            update: jest.fn().mockImplementation(async ({ data }: any) => ({
              id: 5,
              ...data,
            })),
          },
        }),
      ),
    };
    service = new ProductionOrdersService(
      prisma,
      stock as any,
      {
        assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
        resolveInventoryPolicy: jest
          .fn()
          .mockResolvedValue({ allowOversell: false, allowIngredientOveruse: true }),
      } as any,
      { emit: jest.fn() } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('por defecto rechaza 4 unidades de una receta que rinde 10', async () => {
    await expect(service.complete(5, { produced_qty: 4 })).rejects.toMatchObject({
      errorCode: 'PRODUCTION_QTY_NOT_YIELD_MULTIPLE',
    });
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('con allowPartialBatch produce 4, escala el consumo y usa source_module manufacturing', async () => {
    const onProduced = jest.fn().mockResolvedValue({ status: 'partially_completed' });
    const result = await service.complete(
      5,
      { produced_qty: 4 },
      { allowPartialBatch: true, sourceModule: 'manufacturing', onProduced },
    );

    const [consume, produce] = stock.updateStock.mock.calls.map((c) => c[0]);
    expect(consume.movement_type).toBe('consumption');
    expect(consume.quantity_change).toBe(-4); // 10 * (4/10)
    expect(consume.source_module).toBe('manufacturing');
    expect(produce.quantity_change).toBe(4);
    expect(produce.source_module).toBe('manufacturing');
    expect(onProduced).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        producedQty: 4,
        totalCost: 8,
        consumptions: [expect.objectContaining({ component_product_id: 99, consumed_qty: 4 })],
      }),
    );
    expect((result as { status: string }).status).toBe('partially_completed');
  });
});
