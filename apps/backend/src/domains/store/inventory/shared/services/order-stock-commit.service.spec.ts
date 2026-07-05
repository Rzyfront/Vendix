import { OrderStockCommitService } from './order-stock-commit.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from './stock-level-manager.service';
import { StockValidatorService } from './stock-validator.service';
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
  let stockValidatorMock: any;
  let serialEnforcementMock: any;
  let serialNumbersMock: any;

  /** Orden con UNA línea tracked, no-service, sin consumir aún. */
  const buildOrder = () => ({
    id: 1,
    stores: { organization_id: 1, industries: [] },
    order_items: [
      {
        id: 10,
        product_id: 100,
        product_variant_id: null,
        quantity: 1,
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
      stock_reservations: { findFirst: jest.fn().mockResolvedValue(null) },
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

    stockValidatorMock = {
      validateAvailability: jest
        .fn()
        .mockResolvedValue({ isAvailable: true, available: 10 }),
    };

    serialEnforcementMock = { isSerialized: jest.fn().mockResolvedValue(false) };
    serialNumbersMock = {};

    service = new OrderStockCommitService(
      prismaMock as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      stockValidatorMock as unknown as StockValidatorService,
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
