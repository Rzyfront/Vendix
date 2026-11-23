import { LayawayService } from './layaway.service';
import { RequestContextService } from '@common/context/request-context.service';

jest.mock('../products/services/product-usage-nature.util', () => ({
  assertSaleNatureLines: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../products/services/tier-snapshot.util', () => ({
  resolveTierSnapshotsForItems: jest.fn().mockResolvedValue([]),
}));

/**
 * Crear un separado reserva el stock de cada línea dentro de la transacción
 * del plan. La bodega por defecto de una línea sin bodega explícita se
 * resuelve con esa misma transacción: sin `tx` cada línea pide otra conexión
 * del pool mientras la transacción sigue abierta y, bajo carga, el pool se
 * agota y la creación vence.
 */
describe('LayawayService.create — reserva de stock dentro de la tx', () => {
  const build = () => {
    const tx = {
      layaway_plans: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 5 }),
        findUnique: jest.fn().mockResolvedValue({ id: 5 }),
      },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      layaway_items: { create: jest.fn().mockResolvedValue({}) },
      layaway_installments: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(3),
      reserveStock: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LayawayService(
      prisma as any,
      stockLevelManager as any,
      { emit: jest.fn() } as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 10,
      user_id: 9,
      organization_id: 1,
    } as never);
    return { service, tx, stockLevelManager };
  };

  const dto = (item: Record<string, unknown> = {}) =>
    ({
      customer_id: 3,
      items: [
        {
          product_id: 100,
          product_name: 'Bicicleta',
          quantity: 1,
          unit_price: 100,
          ...item,
        },
      ],
      installments: [{ amount: 100, due_date: '2026-12-15' }],
    }) as any;

  afterEach(() => jest.restoreAllMocks());

  it('una línea sin bodega resuelve la bodega por defecto con la tx del plan', async () => {
    const { service, tx, stockLevelManager } = build();

    await service.create(dto());

    expect(stockLevelManager.getDefaultLocationForProduct).toHaveBeenCalledWith(
      100, undefined, tx,
    );
    // La reserva sigue cayendo en esa bodega, dentro de la misma tx.
    expect(stockLevelManager.reserveStock).toHaveBeenCalledWith(
      100, undefined, 3, 1, 'layaway', 5, 9, true, tx, null, false, undefined,
    );
  });

  it('una línea con bodega explícita no consulta la bodega por defecto (sin cambios)', async () => {
    const { service, tx, stockLevelManager } = build();

    await service.create(dto({ location_id: 8 }));

    expect(stockLevelManager.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(stockLevelManager.reserveStock).toHaveBeenCalledWith(
      100, undefined, 8, 1, 'layaway', 5, 9, true, tx, null, false, undefined,
    );
  });
});
