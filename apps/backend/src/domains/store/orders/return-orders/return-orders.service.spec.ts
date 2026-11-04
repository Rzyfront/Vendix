import { return_order_status_enum } from '@prisma/client';
import { ReturnOrdersService } from './return-orders.service';

/**
 * `process` mueve unidades de STOCK (no la cantidad lógica) y descuenta lo que
 * ya movieron devoluciones procesadas antes contra la misma venta.
 */
describe('ReturnOrdersService.process — unidades de stock por línea devuelta', () => {
  const build = (opts: {
    soldLines: unknown[];
    previous?: unknown[];
    returnItems: Array<{ id: number; product_id: number; quantity: number; product_variant_id?: number | null }>;
  }) => {
    const tx = {
      return_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: 99,
          organization_id: 3,
          type: 'sales_return',
          status: return_order_status_enum.draft,
          related_order_id: 500,
          related_order_type: 'sales_order',
          reason_id: null,
          return_order_items: opts.returnItems.map((item) => ({
            product_variant_id: null,
            condition: 'good',
            ...item,
          })),
        }),
        update: jest.fn().mockResolvedValue({ id: 99, related_order_id: null }),
      },
      order_items: { findMany: jest.fn().mockResolvedValue(opts.soldLines) },
      return_order_items: { findMany: jest.fn().mockResolvedValue(opts.previous ?? []) },
    };
    const prisma = { $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue(undefined),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
    };
    const service = new ReturnOrdersService(
      prisma as never,
      stockLevelManager as never,
      { emit: jest.fn() } as never,
    );
    const moved = () =>
      stockLevelManager.updateStock.mock.calls.map(([args]) => args.quantity_change);
    return { service, tx, moved };
  };

  it('reingreso de una pesada de 0,180 kg (stock en g) mueve 180', async () => {
    const { service, moved } = build({
      soldLines: [
        { id: 1, product_id: 7, product_variant_id: null, quantity: 1, stock_units_consumed: 180, weight: '0.180' },
      ],
      returnItems: [{ id: 10, product_id: 7, quantity: 1 }],
    });
    await service.process(99, [{ id: 10, action: 'restock' }]);
    expect(moved()).toEqual([180]);
  });

  it('devolución parcial repetida: descuenta lo que ya devolvió una devolución procesada antes', async () => {
    const { service, tx, moved } = build({
      soldLines: [
        { id: 1, product_id: 9, product_variant_id: null, quantity: 4, stock_units_consumed: 200, weight: null },
      ],
      previous: [{ product_id: 9, product_variant_id: null, quantity: 3 }],
      returnItems: [{ id: 10, product_id: 9, quantity: 2 }],
    });
    await service.process(99, [{ id: 10, action: 'restock' }]);
    // Quedaba 1 bulto (50): pedir 2 no reingresa 100.
    expect(moved()).toEqual([50]);
    expect(tx.return_order_items.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          return_order_id: { not: 99 },
          return_orders: {
            organization_id: 3,
            related_order_id: 500,
            type: 'sales_return',
            OR: [{ related_order_type: null }, { related_order_type: 'sales_order' }],
            status: return_order_status_enum.processed,
          },
        }),
      }),
    );
  });

  it('bulto + sueltas en la misma venta: la baja de 3 sueltas mueve -3, no -40', async () => {
    const { service, moved } = build({
      soldLines: [
        { id: 1, product_id: 9, product_variant_id: null, quantity: 1, stock_units_consumed: 50, weight: null },
        { id: 2, product_id: 9, product_variant_id: null, quantity: 3, stock_units_consumed: null, weight: null },
      ],
      returnItems: [{ id: 10, product_id: 9, quantity: 3 }],
    });
    await service.process(99, [{ id: 10, action: 'write_off' }]);
    expect(moved()).toEqual([-3]);
  });
});
