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
      orders: { findUnique: jest.fn().mockResolvedValue(buildOrder()), findFirst: jest.fn().mockResolvedValue(buildOrder()) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1, state: 'processing' }]),
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
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
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

  it.each([undefined, [{ product_id: 100, product_variant_id: null, serial_ids: [], serial_numbers: [] }]])(
    'direct_delivery serial exige selección explícita aun si flow/pay omite flags FE (%s)',
    async (posSelection) => {
      const direct = buildOrder();
      direct.order_items[0].products = {
        ...direct.order_items[0].products,
        product_type: 'physical',
        requires_serial_numbers: true,
      } as any;
      txMock.orders.findUnique.mockResolvedValue({ ...direct, delivery_type: 'direct_delivery' });
      serialEnforcementMock.isSerialized.mockResolvedValue(true);
      await expect(service.commitOrderDelivery(1, {
        ...OPTS, consumeSerials: true, posSelection,
      }, txMock)).rejects.toMatchObject({ errorCode: 'SERIAL_REQUIRED_001' });
      expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
      expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    },
  );

  it('direct_delivery serial rejects a selection for a different product', async () => {
    const direct = buildOrder();
    direct.order_items[0].products = {
      ...direct.order_items[0].products, product_type: 'physical',
      requires_serial_numbers: true,
    } as any;
    txMock.orders.findUnique.mockResolvedValue({ ...direct, delivery_type: 'direct_delivery' });
    await expect(service.commitOrderDelivery(1, {
      ...OPTS, consumeSerials: true,
      posSelection: [{ product_id: 999, serial_ids: [1] }],
    }, txMock)).rejects.toMatchObject({ errorCode: 'SERIAL_REQUIRED_001' });
    expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
  });

  it('direct_delivery serial with confirmed selection still commits and links the line', async () => {
    const direct = buildOrder();
    direct.order_items[0].products = {
      ...direct.order_items[0].products, product_type: 'physical',
      requires_serial_numbers: true,
    } as any;
    txMock.orders.findUnique.mockResolvedValue({ ...direct, delivery_type: 'direct_delivery' });
    txMock.order_items.updateMany.mockResolvedValue({ count: 1 });
    serialEnforcementMock.isSerialized.mockResolvedValue(true);
    serialEnforcementMock.resolveOrCreateFromFreeText = jest.fn().mockResolvedValue([]);
    serialEnforcementMock.requireConfirmedSerials = jest.fn().mockResolvedValue(undefined);
    serialNumbersMock.transition = jest.fn().mockResolvedValue({ serial_number: 'IMEI-1' });
    serialNumbersMock.linkToDocument = jest.fn().mockResolvedValue(undefined);

    const result = await service.commitOrderDelivery(1, {
      ...OPTS, consumeSerials: true,
      posSelection: [{ product_id: 100, product_variant_id: null, serial_ids: [1] }],
    }, txMock);

    expect(result.committedItemCount).toBe(1);
    expect(serialNumbersMock.linkToDocument).toHaveBeenCalledWith(1, 'order_item', 10, txMock);
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a consumir un plato cuyo BOM ya se descontó al disparar a cocina', async () => {
    const firedOrder: any = buildOrder();
    firedOrder.stores.industries = ['restaurant'];
    firedOrder.order_items[0].products.product_type = 'prepared';
    firedOrder.order_items[0].inventory_consumed_at_fire = true;
    txMock.orders.findFirst.mockResolvedValue(firedOrder);
    txMock.orders.findUnique.mockResolvedValue(firedOrder);

    const result = await service.commitOrderDelivery(1, OPTS, txMock);

    expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.releaseReservation).not.toHaveBeenCalled();
    expect(result.committedItemCount).toBe(0);
  });

  it('no descuenta el plato preparado pendiente de fire al cobrar la orden restaurante', async () => {
    const pendingOrder: any = buildOrder();
    pendingOrder.stores.industries = ['restaurant'];
    pendingOrder.order_items[0].products.product_type = 'prepared';
    txMock.orders.findFirst.mockResolvedValue(pendingOrder);
    txMock.orders.findUnique.mockResolvedValue(pendingOrder);

    const result = await service.commitOrderDelivery(1, OPTS, txMock);

    expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    expect(result.committedItemCount).toBe(0);
  });

  it('no consume una orden cancelada aunque el callback llegue tarde', async () => {
    txMock.$queryRaw.mockResolvedValue([{ id: 1, state: 'cancelled' }]);
    await expect(service.commitOrderDelivery(1, OPTS, txMock)).rejects
      .toMatchObject({ errorCode: 'ORD_STOCK_COMMIT_STATE_001' });
    expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
  });

  it('sin tx abre una transacción que incluye claim y stock', async () => {
    prismaMock.$transaction = jest.fn(async (callback) => callback(txMock));
    txMock.order_items.updateMany.mockResolvedValue({ count: 1 });
    await service.commitOrderDelivery(1, OPTS);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledWith(expect.anything(), txMock);
  });

  it('notifica solo después de que la transacción propietaria hizo commit', async () => {
    let committed = false;
    const publish = jest.fn(() => expect(committed).toBe(true));
    prismaMock.$transaction = jest.fn(async (cb) => {
      const result = await cb(txMock); committed = true; return result;
    });
    txMock.order_items.updateMany.mockResolvedValue({count:1});
    stockLevelManagerMock.updateStock.mockImplementation(async (params) => {
      params.afterCommit.push(publish);
      return {cost_snapshot:{total_cost:0}};
    });
    await service.commitOrderDelivery(1, OPTS);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rollback descarta notificaciones que se prepararon antes del fallo', async () => {
    const publish = jest.fn();
    prismaMock.$transaction = jest.fn(async (cb) => cb(txMock));
    txMock.order_items.updateMany.mockResolvedValue({count:1});
    stockLevelManagerMock.updateStock.mockImplementation(async (params) => {
      params.afterCommit.push(publish);
      throw new Error('fallo de escritura');
    });
    await expect(service.commitOrderDelivery(1, OPTS)).rejects.toThrow('fallo de escritura');
    expect(publish).not.toHaveBeenCalled();
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
      orders: { findUnique: jest.fn().mockResolvedValue(buildOrder(quantity)), findFirst: jest.fn().mockResolvedValue(buildOrder(quantity)) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1, state: 'processing' }]),
      order_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      stock_reservations: { findMany: jest.fn().mockResolvedValue(reservations) },
    };

    stockLevelManagerMock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
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

  it('libera la reserva completa de la línea (bounded a su propia cantidad) repartida en dos ubicaciones, no solo la primera', async () => {
    setup(10, SPLIT_LEVELS, [
      { location_id: 1, quantity: 8 },
      { location_id: 2, quantity: 2 },
    ]);

    await service.commitOrderDelivery(1, OPTS, txMock);

    // Release/consume es UNA llamada acotada a la cantidad TOTAL de la línea
    // (10) — no una por ubicación — y StockLevelManager es quien reparte
    // internamente oldest-first entre las reservas.
    expect(stockLevelManagerMock.releaseReservationQuantity).toHaveBeenCalledWith(
      'order',
      1,
      100,
      null,
      10,
      'consumed',
      txMock,
      { decrementOnHand: false },
    );
    // La previsualización (para preferir ubicaciones en el allocator) sigue
    // viendo AMBAS ubicaciones de la reserva, no solo la primera.
    expect(allocatorMock.allocateForLine).toHaveBeenCalledWith(
      7,
      100,
      undefined,
      10,
      [1, 2],
      txMock,
    );
  });
});

/**
 * No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md).
 *
 * Dos reglas nuevas sobre `processLine`:
 *  - El release de reserva está acotado a la cantidad PROPIA de la línea, así
 *    que dos líneas de la orden que reservan el MISMO producto/variante no se
 *    pisan: comitear una nunca debe liberar la reserva de la otra.
 *  - Una línea con `cancelled_at` no nulo nunca deduce stock, sin importar si
 *    trackea inventario.
 */
describe('OrderStockCommitService — no-overselling guard (commitOrderLines / cancelled_at)', () => {
  let service: OrderStockCommitService;
  let txMock: any;
  let stockLevelManagerMock: any;
  let allocatorMock: any;
  let reservationsStore: Array<{
    id: number;
    location_id: number;
    quantity: number;
    status: string;
  }>;

  const OPTS = { blockOnInsufficient: true };

  /** Una orden con UNA sola línea (id 10) — la línea hermana (id 11, misma
   * identidad de producto) nunca se carga en este `findUnique` porque
   * `commitOrderLines([10])` la filtraría en la query real; su reserva
   * (id 1002 en `reservationsStore`) solo debe sobrevivir intacta. */
  const buildOrder = (cancelled = false) => ({
    id: 1,
    store_id: 7,
    delivery_type: null,
    stores: { organization_id: 1, industries: [] },
    order_items: [
      {
        id: 10,
        product_id: 100,
        product_variant_id: null,
        quantity: 1,
        stock_units_consumed: null,
        products: {
          id: 100,
          track_inventory: true,
          product_type: 'simple',
          name: 'Camiseta',
        },
        product_variants: null,
        inventory_committed: false,
        inventory_consumed_at_fire: false,
        skip_kds: false,
        cancelled_at: cancelled ? new Date() : null,
      },
    ],
  });

  beforeEach(() => {
    reservationsStore = [
      { id: 1001, location_id: 3, quantity: 1, status: 'active' }, // línea 10 (más antigua)
      { id: 1002, location_id: 3, quantity: 1, status: 'active' }, // línea 11 hermana — NO se toca
    ];

    txMock = {
      orders: {
        findUnique: jest.fn().mockResolvedValue(buildOrder()),
        findFirst: jest.fn().mockResolvedValue(buildOrder()),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1, state: 'processing' }]),
      order_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      stock_reservations: {
        findMany: jest.fn(async () =>
          reservationsStore.filter((r) => r.status === 'active'),
        ),
      },
    };

    stockLevelManagerMock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(3),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      // Fake fiel a la semántica real (oldest-first, acotado a `quantity`)
      // para poder aserir el estado de `reservationsStore` después.
      releaseReservationQuantity: jest.fn(
        async (
          _refType: string,
          _refId: number,
          _productId: number,
          _variantId: number | null,
          quantity: number,
          status: string,
        ) => {
          let remaining = quantity;
          let released = 0;
          for (const r of reservationsStore) {
            if (remaining <= 0) break;
            if (r.status !== 'active') continue;
            const take = Math.min(r.quantity, remaining);
            if (take <= 0) continue;
            if (take >= r.quantity) {
              r.status = status;
            } else {
              r.quantity -= take;
            }
            released += take;
            remaining -= take;
          }
          return released;
        },
      ),
      updateStock: jest
        .fn()
        .mockResolvedValue({ cost_snapshot: { total_cost: 0 } }),
    };

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
          [{ location_id: 3, quantity_available: 10 }],
          preferred,
        ),
      ),
    };

    service = new OrderStockCommitService(
      { withoutScope: jest.fn(() => txMock) } as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      allocatorMock as unknown as SellableStockAllocator,
      { isSerialized: jest.fn().mockResolvedValue(false) } as any,
      {} as unknown as InventorySerialNumbersService,
    );
  });

  it('commitOrderLines libera solo la cantidad propia de la línea; la reserva hermana sigue activa', async () => {
    await service.commitOrderLines(1, [10], { ...OPTS, tx: txMock });

    expect(stockLevelManagerMock.releaseReservationQuantity).toHaveBeenCalledWith(
      'order',
      1,
      100,
      null,
      1,
      'consumed',
      txMock,
      { decrementOnHand: false },
    );

    // Reserva de la línea propia (más antigua): liberada completa.
    expect(reservationsStore.find((r) => r.id === 1001)?.status).toBe(
      'consumed',
    );
    // Reserva de la línea HERMANA: intacta, con su propia cantidad.
    const sibling = reservationsStore.find((r) => r.id === 1002);
    expect(sibling?.status).toBe('active');
    expect(sibling?.quantity).toBe(1);
  });

  it('no descuenta ni marca committed una línea cancelada (order_items.cancelled_at)', async () => {
    txMock.orders.findUnique.mockResolvedValue(buildOrder(true));
    txMock.orders.findFirst.mockResolvedValue(buildOrder(true));

    const result = await service.commitOrderLines(1, [10], {
      ...OPTS,
      tx: txMock,
    });

    expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.releaseReservationQuantity).not.toHaveBeenCalled();
    expect(result.committedItemCount).toBe(0);

    // Ninguna reserva se tocó — ni la propia ni la hermana.
    expect(reservationsStore.every((r) => r.status === 'active')).toBe(true);
  });
});
