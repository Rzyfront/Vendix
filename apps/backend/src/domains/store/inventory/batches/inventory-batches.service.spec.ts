import { InventoryBatchesService } from './inventory-batches.service';

/**
 * Cada operación de lote abre su propia transacción y mueve stock con
 * `updateStock`. Sin el cliente de esa transacción, `updateStock` abre OTRA
 * transacción en una segunda conexión del pool: el lote y el stock dejan de
 * ser atómicos y, bajo carga, la transacción de afuera espera una conexión
 * que no llega y vence.
 */
describe('InventoryBatchesService — el stock se mueve en la tx del lote', () => {
  const BATCH = {
    id: 7,
    product_id: 100,
    product_variant_id: null,
    batch_number: 'L-7',
    quantity: 10,
    quantity_used: 2,
    manufacturing_date: null,
    expiration_date: null,
    location_id: 1,
  };

  const build = () => {
    const tx = {
      inventory_batches: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 8 }),
        update: jest.fn().mockResolvedValue({ id: 7 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      inventory_batches: { findUnique: jest.fn().mockResolvedValue(BATCH) },
    };
    const stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue({ stock_level: null }),
    };
    const service = new InventoryBatchesService(
      prisma as any,
      stockLevelManager as any,
    );
    return { service, tx, stockLevelManager };
  };

  it('crear un lote suma su cantidad con la tx del lote', async () => {
    const { service, tx, stockLevelManager } = build();

    await service.createBatch({
      product_id: 100,
      location_id: 3,
      quantity: 5,
      batchNumber: 'L-8',
    } as any);

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 100,
        location_id: 3,
        quantity_change: 5,
        movement_type: 'stock_in',
      }),
      tx,
    );
  });

  it('usar cantidad de un lote descuenta el stock con la tx del lote', async () => {
    const { service, tx, stockLevelManager } = build();

    await service.updateBatchQuantity(7, 3, 9);

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 100,
        location_id: 1,
        quantity_change: -3,
        movement_type: 'sale',
        validate_availability: true,
      }),
      tx,
    );
  });

  it('transferir un lote mueve la salida y la entrada con la tx del lote', async () => {
    const { service, tx, stockLevelManager } = build();

    await service.transferBatch(7, 4, 2, 9);

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(2);
    expect(stockLevelManager.updateStock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ location_id: 1, quantity_change: -2, movement_type: 'transfer' }),
      tx,
    );
    expect(stockLevelManager.updateStock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ location_id: 4, quantity_change: 2, movement_type: 'transfer' }),
      tx,
    );
  });

  it('un lote sin saldo para transferir se rechaza antes de abrir la tx (sin cambios)', async () => {
    const { service, stockLevelManager } = build();

    await expect(service.transferBatch(7, 4, 50, 9)).rejects.toThrow(
      'Insufficient quantity available for transfer',
    );
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });
});
