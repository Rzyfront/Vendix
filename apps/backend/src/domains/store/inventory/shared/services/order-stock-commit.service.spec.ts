import { OrderStockCommitService } from './order-stock-commit.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from './stock-level-manager.service';
import { SellableStockAllocator } from './sellable-stock-allocator.service';
import { SerialNumberEnforcementService } from '../../serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../serial-numbers/inventory-serial-numbers.service';

/**
 * Regresión del claim atómico de {@link OrderStockCommitService.processLine}.
 *
 * Regla dura: prohibido el DOBLE DESCUENTO de stock. La idempotencia por
 * `order_items.inventory_committed` ya no es un read-then-write (frágil bajo
 * READ COMMITTED ante un doble-submit concurrente): la deducción ahora la
 * SERIALIZA un UPDATE condicional
 *   `UPDATE order_items SET inventory_committed=true WHERE id=? AND inventory_committed=false`.
 * El ganador de la carrera obtiene `count=1` (deduce); el perdedor obtiene
 * `count=0` y debe SALIR sin tocar `StockLevelManager.updateStock`.
 *
 * Estas pruebas reducen esa carrera a una aserción determinista mockeando el
 * resultado del `updateMany` — sin BD ni concurrencia real.
 */
describe('OrderStockCommitService — claim atómico anti doble-descuento', () => {
  let service: OrderStockCommitService;
  let prismaMock: any;
  let txMock: any;
  let stockLevelManagerMock: any;
  let allocatorMock: any;
  let serialEnforcementMock: any;
  let serialNumbersMock: any;

  /** Orden con UNA línea tracked, no-service, sin consumir aún. */
  const buildOrder = (quantity = 1) => ({
    id: 1,
    store_id: 7,
    stores: { organization_id: 1, industries: [] },
    order_items: [
      {
        id: 10,
        product_id: 100,
        product_variant_id: null,
        quantity,
        stock_units_consumed: null,
        products: { id: 100, track_inventory: true, product_type: 'simple' },
        product_variants: null,
        inventory_committed: false,
        inventory_consumed_at_fire: false,
        skip_kds: false,
      },
    ],
  });

  const OPTS = {
    movementType: 'sale' as const,
    blockOnInsufficient: true,
    consumeSerials: false,
    reason: 'test',
  };

  beforeEach(() => {
    txMock = {
      orders: { findUnique: jest.fn().mockResolvedValue(buildOrder()) },
      order_items: { updateMany: jest.fn() },
      // reservationReader = tx (tx presente) → sin reserva activa.
      stock_reservations: { findMany: jest.fn().mockResolvedValue([]) },
    };

    prismaMock = {
      withoutScope: jest.fn(() => prismaMock),
    };

    stockLevelManagerMock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(3),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      updateStock: jest
        .fn()
        .mockResolvedValue({ cost_snapshot: { total_cost: 0 } }),
    };

    // El allocator real es puro salvo la lectura; se mockea SOLO la lectura y
    // se conserva `allocate`/`absorbShortfall` reales para que estas pruebas
    // ejerciten el reparto de verdad.
    const realAllocator = new SellableStockAllocator({} as any);
    allocatorMock = {
      getSellableLevels: jest
        .fn()
        .mockResolvedValue([{ location_id: 3, quantity_available: 10 }]),
      allocate: realAllocator.allocate.bind(realAllocator),
      absorbShortfall: realAllocator.absorbShortfall.bind(realAllocator),
      allocateForLine: jest.fn(async (_s, _p, _v, qty, preferred = []) =>
        realAllocator.allocate(
          qty,
          await allocatorMock.getSellableLevels(),
          preferred,
        ),
      ),
    };

    serialEnforcementMock = { isSerialized: jest.fn().mockResolvedValue(false) };
    serialNumbersMock = {};

    service = new OrderStockCommitService(
      prismaMock as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      allocatorMock as unknown as SellableStockAllocator,
      serialEnforcementMock as unknown as SerialNumberEnforcementService,
      serialNumbersMock as unknown as InventorySerialNumbersService,
    );
  });

  it('perdedor de la carrera (updateMany count=0) NO deduce stock ni marca committed', async () => {
    txMock.order_items.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.commitOrderDelivery(1, OPTS, txMock);

    // El claim lo ganó otra tx → esta línea sale ANTES de tocar el stock.
    expect(txMock.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: 10, inventory_committed: false },
      data: expect.objectContaining({ inventory_committed: true }),
    });
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.releaseReservation).not.toHaveBeenCalled();
    expect(result.committedItemCount).toBe(0);
  });

  it('ganador de la carrera (updateMany count=1) deduce exactamente una vez', async () => {
    txMock.order_items.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.commitOrderDelivery(1, OPTS, txMock);

    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 100,
        quantity_change: -1,
        movement_type: 'sale',
      }),
      txMock,
    );
    expect(result.committedItemCount).toBe(1);
  });
});

/**
 * QUI-559 — el bloqueo por stock depende del TOTAL vendible de la tienda, nunca
 * de cómo ese total esté repartido entre ubicaciones.
 */
describe('OrderStockCommitService — descuento multi-ubicación', () => {
  let service: OrderStockCommitService;
  let txMock: any;
  let stockLevelManagerMock: any;
  let allocatorMock: any;

  /** 8 unidades en la ubicación 1 + 4 en la 2: el fixture del ticket. */
  const SPLIT_LEVELS = [
    { location_id: 1, quantity_available: 8 },
    { location_id: 2, quantity_available: 4 },
  ];

  const OPTS = {
    movementType: 'sale' as const,
    blockOnInsufficient: true,
    consumeSerials: false,
    reason: 'test',
  };

  const buildOrder = (quantity: number) => ({
    id: 1,
    store_id: 7,
    stores: { organization_id: 1, industries: [] },
    order_items: [
      {
        id: 10,
        product_id: 100,
        product_variant_id: null,
        quantity,
        stock_units_consumed: null,
        products: { id: 100, track_inventory: true, product_type: 'simple' },
        product_variants: null,
        inventory_committed: false,
        inventory_consumed_at_fire: false,
        skip_kds: false,
      },
    ],
  });

  /** Arma el servicio con un allocator real sobre `levels` en memoria. */
  const setup = (quantity: number, levels = SPLIT_LEVELS, reservations: any[] = []) => {
    txMock = {
      orders: { findUnique: jest.fn().mockResolvedValue(buildOrder(quantity)) },
      order_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      stock_reservations: { findMany: jest.fn().mockResolvedValue(reservations) },
    };

    stockLevelManagerMock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      updateStock: jest
        .fn()
        .mockResolvedValue({ cost_snapshot: { total_cost: 0 } }),
    };

    const realAllocator = new SellableStockAllocator({} as any);
    allocatorMock = {
      allocate: realAllocator.allocate.bind(realAllocator),
      absorbShortfall: realAllocator.absorbShortfall.bind(realAllocator),
      getSellableLevels: jest.fn().mockResolvedValue(levels),
      allocateForLine: jest.fn(async (_s, _p, _v, qty, preferred = []) =>
        realAllocator.allocate(qty, levels, preferred),
      ),
    };

    service = new OrderStockCommitService(
      { withoutScope: jest.fn() } as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      allocatorMock as unknown as SellableStockAllocator,
      { isSerialized: jest.fn().mockResolvedValue(false) } as any,
      {} as unknown as InventorySerialNumbersService,
    );
  };

  it('8+4 → venta de 10 descuenta en DOS ubicaciones (antes: INV_STOCK_002)', async () => {
    setup(10);

    const result = await service.commitOrderDelivery(1, OPTS, txMock);

    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(2);
    expect(stockLevelManagerMock.updateStock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ location_id: 1, quantity_change: -8 }),
      txMock,
    );
    expect(stockLevelManagerMock.updateStock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ location_id: 2, quantity_change: -2 }),
      txMock,
    );
    expect(result.committedItemCount).toBe(1);
  });

  it('8+4 → venta de 13 sigue bloqueando con INV_STOCK_002 y `available: 12`', async () => {
    setup(13);

    await expect(service.commitOrderDelivery(1, OPTS, txMock)).rejects.toMatchObject({
      errorCode: 'INV_STOCK_002',
    });
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
  });

  it('línea que cabe en una ubicación mantiene UN solo updateStock (no regresión)', async () => {
    setup(5);

    await service.commitOrderDelivery(1, OPTS, txMock);

    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: 1, quantity_change: -5 }),
      txMock,
    );
  });

  it('libera TODAS las reservas de la línea, no solo la primera', async () => {
    setup(10, SPLIT_LEVELS, [{ location_id: 1 }, { location_id: 2 }]);

    await service.commitOrderDelivery(1, OPTS, txMock);

    expect(stockLevelManagerMock.releaseReservation).toHaveBeenCalledTimes(2);
    expect(stockLevelManagerMock.releaseReservation).toHaveBeenCalledWith(
      100,
      undefined,
      1,
      'order',
      1,
      txMock,
    );
    expect(stockLevelManagerMock.releaseReservation).toHaveBeenCalledWith(
      100,
      undefined,
      2,
      'order',
      1,
      txMock,
    );
  });
});
