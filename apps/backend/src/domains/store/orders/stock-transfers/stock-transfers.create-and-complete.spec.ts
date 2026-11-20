/**
 * Movimiento rápido de tienda (`POST /store/stock-transfers/complete`):
 * multi-producto con variantes, en una transacción, sin dobles descuentos.
 */
jest.mock('../../workflows/engine/workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(false),
}));

import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StockTransfersService } from './stock-transfers.service';

describe('StockTransfersService — createAndComplete (movimiento rápido)', () => {
  let tx: any;
  let prisma: any;
  let stockLevelManager: { updateStock: jest.Mock };
  let events: { emit: jest.Mock };
  let service: StockTransfersService;

  const dto = (items: any[]) => ({
    from_location_id: 7,
    to_location_id: 9,
    notes: 'Reposición',
    items,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    tx = {
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue({
          quantity_available: 50,
          products: { name: 'Camisa' },
          product_variants: null,
        }),
      },
      product_variants: { count: jest.fn().mockResolvedValue(0) },
      stock_transfers: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 100,
            transfer_number: data.transfer_number,
            from_location_id: data.from_location_id,
            to_location_id: data.to_location_id,
            stock_transfer_items: data.stock_transfer_items.create.map(
              (it: any, i: number) => ({ id: i + 1, ...it }),
            ),
          }),
        ),
        findUnique: jest.fn().mockResolvedValue({
          id: 100,
          transfer_number: 'TRF-1',
          organization_id: 1,
          from_location_id: 7,
          to_location_id: 9,
          from_location: { store_id: 3 },
          to_location: { store_id: 3 },
          stock_transfer_items: [],
        }),
      },
    };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      stock_levels: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    stockLevelManager = {
      updateStock: jest
        .fn()
        .mockResolvedValue({ cost_snapshot: { unit_cost: 1200 } }),
    };
    events = { emit: jest.fn() };
    const operatingScope = {
      validateLocationScope: jest.fn().mockResolvedValue({
        scope: 'STORE',
        locations: [{ store_id: 3 }, { store_id: 3 }],
      }),
    };
    service = new StockTransfersService(
      prisma,
      stockLevelManager as any,
      events as any,
      operatingScope as any,
      { isKillSwitchOn: () => false } as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 1,
      store_id: 3,
      user_id: 55,
    } as any);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(55);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
  });

  it('mueve varias líneas (dos variantes del mismo producto) con su variante', async () => {
    await service.createAndComplete(
      dto([
        { product_id: 1, product_variant_id: 10, quantity: 2 },
        { product_id: 1, product_variant_id: 11, quantity: 3 },
        { product_id: 2, quantity: 1 },
      ]) as any,
    );

    const created = tx.stock_transfers.create.mock.calls[0][0].data;
    expect(created.stock_transfer_items.create).toEqual([
      expect.objectContaining({ product_id: 1, product_variant_id: 10, quantity: 2, quantity_received: 2 }),
      expect.objectContaining({ product_id: 1, product_variant_id: 11, quantity: 3, quantity_received: 3 }),
      expect.objectContaining({ product_id: 2, product_variant_id: undefined, quantity: 1, quantity_received: 1 }),
    ]);
    expect(created.created_by_user_id).toBe(55);

    // Una salida y una entrada por línea: 6 movimientos, nunca más.
    const calls = stockLevelManager.updateStock.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(6);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        variant_id: 10,
        location_id: 7,
        quantity_change: -2,
        validate_availability: true,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        variant_id: 10,
        location_id: 9,
        quantity_change: 2,
        unit_cost: 1200,
      }),
    );
    expect(calls[3]).toEqual(
      expect.objectContaining({ variant_id: 11, location_id: 9, quantity_change: 3 }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'stock_transfer.completed',
      expect.objectContaining({ transfer_id: 100 }),
    );
  });

  it('rechaza un par producto + variante repetido antes de mover stock', async () => {
    await expect(
      service.createAndComplete(
        dto([
          { product_id: 1, product_variant_id: 10, quantity: 2 },
          { product_id: 1, product_variant_id: 10, quantity: 2 },
        ]) as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.stock_transfers.create).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });

  it('producto con variantes sin variante elegida: error claro, sin movimiento', async () => {
    tx.stock_levels.findFirst.mockResolvedValue(null);
    tx.product_variants.count.mockResolvedValue(3);

    await expect(
      service.createAndComplete(dto([{ product_id: 1, quantity: 1 }]) as any),
    ).rejects.toThrow(/maneja variantes/);
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });
});
