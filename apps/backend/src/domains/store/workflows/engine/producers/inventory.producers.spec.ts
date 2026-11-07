import { transfer_status_enum } from '@prisma/client';
import { StockTransfersService } from '../../../orders/stock-transfers/stock-transfers.service';
import { InventoryAdjustmentsService } from '../../../inventory/adjustments/inventory-adjustments.service';
import { recordTriggerEvent } from '../workflow-trigger.outbox';
import { runAsStoreAdmin, transactionOf } from './producers.test-util';

jest.mock('../workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(true),
}));

const record = recordTriggerEvent as jest.Mock;

describe('Flujos P1.1 producers: inventory.transferred', () => {
  const locations = {
    from_location: { id: 1, store_id: 11 },
    to_location: { id: 2, store_id: 11 },
  };
  const completedTransfer = {
    id: 70,
    organization_id: 3,
    transfer_number: 'TR-70',
    from_location_id: 1,
    to_location_id: 2,
    status: transfer_status_enum.completed,
    stock_transfer_items: [],
    ...locations,
  };

  const build = (tx: Record<string, unknown>) => {
    const emitter = { emit: jest.fn() };
    const stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { unit_cost: 5 } }),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = { $transaction: transactionOf(tx) };
    const service = new StockTransfersService(
      prisma as never,
      stockLevelManager as never,
      emitter as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(
        service as unknown as { validateTransferScope: () => Promise<unknown> },
        'validateTransferScope',
      )
      .mockResolvedValue({ store_id: 11 });
    jest
      .spyOn(
        service as unknown as { calculateTransferTotalCost: () => Promise<number> },
        'calculateTransferTotalCost',
      )
      .mockResolvedValue(10);
    return { service, emitter };
  };

  beforeEach(() => record.mockClear());

  describe('complete', () => {
    const buildComplete = () => {
      const tx = {
        stock_transfers: {
          findUnique: jest.fn().mockResolvedValue({
            ...completedTransfer,
            status: transfer_status_enum.in_transit,
            stock_transfer_items: [
              { id: 5, product_id: 9, product_variant_id: null, quantity: 3 },
            ],
          }),
          update: jest.fn().mockResolvedValue(completedTransfer),
        },
        stock_transfer_items: { update: jest.fn().mockResolvedValue({}) },
      };
      return { tx, ...build(tx) };
    };

    it('records the event with the transaction that moved the stock', async () => {
      const { tx, service } = buildComplete();
      await runAsStoreAdmin(() =>
        service.complete(70, [{ id: 5, quantity_received: 3 }]),
      );
      expect(record).toHaveBeenCalledWith(tx, 'inventory.transferred', {
        store_id: 11,
        transfer_id: 70,
        transfer_number: 'TR-70',
        from_location_id: 1,
        to_location_id: 2,
      });
    });

    it('records nothing for a partial reception (transfer still in transit)', async () => {
      const { tx, service } = buildComplete();
      await runAsStoreAdmin(() =>
        service.complete(70, [{ id: 5, quantity_received: 1 }]),
      );
      expect(tx.stock_transfers.update).toHaveBeenCalledTimes(1);
      expect(record).not.toHaveBeenCalled();
    });

    it('emits no accounting event when the outbox write fails', async () => {
      const { service, emitter } = buildComplete();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(
        runAsStoreAdmin(() =>
          service.complete(70, [{ id: 5, quantity_received: 3 }]),
        ),
      ).rejects.toThrow('outbox down');
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('createAndComplete', () => {
    const buildCreate = () => {
      const tx = {
        stock_levels: {
          findFirst: jest.fn().mockResolvedValue({ quantity_available: 10 }),
        },
        stock_transfers: {
          create: jest.fn().mockResolvedValue({
            ...completedTransfer,
            stock_transfer_items: [
              { product_id: 9, product_variant_id: null, quantity: 3 },
            ],
          }),
          findUnique: jest.fn().mockResolvedValue(completedTransfer),
        },
      };
      const built = build(tx);
      jest
        .spyOn(
          built.service as unknown as {
            generateTransferNumber: () => Promise<string>;
          },
          'generateTransferNumber',
        )
        .mockResolvedValue('TR-70');
      return { tx, ...built };
    };
    const dto = {
      from_location_id: 1,
      to_location_id: 2,
      items: [{ product_id: 9, quantity: 3 }],
    };

    it('records the event with the transaction of the immediate transfer', async () => {
      const { tx, service } = buildCreate();
      await runAsStoreAdmin(() => service.createAndComplete(dto as never));
      expect(record).toHaveBeenCalledWith(tx, 'inventory.transferred', {
        store_id: 11,
        transfer_id: 70,
        transfer_number: 'TR-70',
        from_location_id: 1,
        to_location_id: 2,
      });
    });

    it('rejects when the outbox write fails', async () => {
      const { service } = buildCreate();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(
        runAsStoreAdmin(() => service.createAndComplete(dto as never)),
      ).rejects.toThrow('outbox down');
    });
  });
});

describe('Flujos P1.1 producer: inventory.adjusted (createAdjustmentInTransaction)', () => {
  const build = () => {
    const tx = {
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue({ quantity_on_hand: 10 }),
      },
      inventory_adjustments: {
        create: jest.fn().mockResolvedValue({
          id: 81,
          product_id: 9,
          location_id: 4,
          product: null,
          location: null,
        }),
      },
    };
    const stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { total_cost: 0 } }),
    };
    // Flujos P1.3 gate lookup: a store without flows governs nothing.
    const prisma = {
      withoutScope: () => ({ stores: { findFirst: async () => null } }),
    };
    const service = new InventoryAdjustmentsService(
      prisma as never,
      stockLevelManager as never,
      { emit: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { tx, service };
  };
  const dto = {
    product_id: 9,
    location_id: 4,
    type: 'count_variance',
    quantity_after: 7,
  };

  beforeEach(() => record.mockClear());

  it('records one event per adjustment row with the caller transaction', async () => {
    const { tx, service } = build();
    await runAsStoreAdmin(() =>
      service.createAdjustmentInTransaction(tx, dto as never),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(tx, 'inventory.adjusted', {
      store_id: 11,
      adjustment_id: 81,
      product_id: 9,
      location_id: 4,
      quantity_change: -3,
      adjustment_type: 'count_variance',
    });
  });

  it('propagates the failure so the caller transaction rolls back', async () => {
    const { tx, service } = build();
    record.mockRejectedValueOnce(new Error('outbox down'));
    await expect(
      runAsStoreAdmin(() =>
        service.createAdjustmentInTransaction(tx, dto as never),
      ),
    ).rejects.toThrow('outbox down');
  });
});
