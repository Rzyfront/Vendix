/**
 * Movimiento rápido de organización (`POST /organization/inventory/transfers/complete`)
 * y picker `GET .../search-products`.
 */
import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { OrgTransfersService } from './org-transfers.service';

describe('OrgTransfersService — movimiento rápido y picker', () => {
  let tx: any;
  let orgPrisma: any;
  let operatingScope: any;
  let stockLevelManager: { updateStock: jest.Mock };
  let events: { emit: jest.Mock };
  let service: OrgTransfersService;

  beforeEach(() => {
    jest.restoreAllMocks();
    tx = {
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue({
          quantity_available: 20,
          products: { name: 'Camisa' },
          product_variants: null,
        }),
      },
      product_variants: { count: jest.fn().mockResolvedValue(0) },
      stock_transfers: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 300,
            transfer_number: data.transfer_number,
            from_location_id: data.from_location_id,
            to_location_id: data.to_location_id,
            stock_transfer_items: data.stock_transfer_items.create.map(
              (it: any, i: number) => ({ id: i + 1, ...it }),
            ),
          }),
        ),
        findUnique: jest.fn().mockResolvedValue({
          id: 300,
          transfer_number: 'TRF-1',
          organization_id: 1,
          status: 'received',
          from_location_id: 7,
          to_location_id: 9,
          from_location: { store_id: 3 },
          to_location: { store_id: null },
          stock_transfer_items: [],
        }),
      },
    };
    orgPrisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
    };
    operatingScope = {
      enforceLocationAccess: jest
        .fn()
        .mockImplementation((_org: number, id: number) =>
          Promise.resolve({ id, store_id: id === 7 ? 3 : null }),
        ),
      assertCrossStoreTransferAllowed: jest.fn(),
    };
    stockLevelManager = {
      updateStock: jest
        .fn()
        .mockResolvedValue({ cost_snapshot: { unit_cost: 800 } }),
    };
    events = { emit: jest.fn() };
    service = new OrgTransfersService(
      orgPrisma,
      operatingScope,
      stockLevelManager as any,
      events as any,
    );
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(55);
  });

  describe('createAndComplete', () => {
    const dto = (items: any[]) =>
      ({ from_location_id: 7, to_location_id: 9, items }) as any;

    it('crea ya recibida con quién la hizo y mueve cada variante (origen −, destino +)', async () => {
      const result = await service.createAndComplete(
        dto([
          { product_id: 1, product_variant_id: 10, quantity: 2 },
          { product_id: 1, product_variant_id: 11, quantity: 1 },
        ]),
      );

      const data = tx.stock_transfers.create.mock.calls[0][0].data;
      expect(data.status).toBe('received');
      expect(data.created_by_user_id).toBe(55);
      expect(data.approved_by_user_id).toBe(55);
      expect(data.dispatched_by_user_id).toBe(55);
      expect(data.stock_transfer_items.create).toEqual([
        expect.objectContaining({ product_variant_id: 10, quantity: 2, quantity_received: 2 }),
        expect.objectContaining({ product_variant_id: 11, quantity: 1, quantity_received: 1 }),
      ]);

      const calls = stockLevelManager.updateStock.mock.calls.map((c) => c[0]);
      expect(calls).toHaveLength(4);
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
          unit_cost: 800,
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'stock_transfer.completed',
        expect.objectContaining({ transfer_id: 300, user_id: 55 }),
      );
      expect(result.status).toBe('received');
    });

    it('valida alcance de ambas ubicaciones en la organización', async () => {
      await service.createAndComplete(dto([{ product_id: 2, quantity: 1 }]));
      expect(operatingScope.enforceLocationAccess).toHaveBeenCalledWith(1, 7, {
        allowCentral: true,
      });
      expect(operatingScope.enforceLocationAccess).toHaveBeenCalledWith(1, 9, {
        allowCentral: true,
      });
    });

    it('rechaza origen = destino y líneas repetidas sin tocar stock', async () => {
      await expect(
        service.createAndComplete({
          from_location_id: 7,
          to_location_id: 7,
          items: [{ product_id: 1, quantity: 1 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createAndComplete(
          dto([
            { product_id: 1, product_variant_id: 10, quantity: 1 },
            { product_id: 1, product_variant_id: 10, quantity: 1 },
          ]),
        ),
      ).rejects.toThrow(/repetido/);
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('stock insuficiente en origen: no crea ni mueve', async () => {
      tx.stock_levels.findFirst.mockResolvedValue({
        quantity_available: 1,
        products: { name: 'Camisa' },
        product_variants: { name: 'Roja', sku: 'R' },
      });
      await expect(
        service.createAndComplete(
          dto([{ product_id: 1, product_variant_id: 10, quantity: 5 }]),
        ),
      ).rejects.toThrow(/Stock insuficiente/);
      expect(tx.stock_transfers.create).not.toHaveBeenCalled();
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });
  });

  describe('searchTransferableProducts', () => {
    const sl = (over: Record<string, any>) => ({
      product_id: 1,
      product_variant_id: null,
      location_id: 7,
      quantity_on_hand: 5,
      quantity_reserved: 0,
      quantity_available: 5,
      products: { id: 1, name: 'Camisa', sku: 'CAM' },
      product_variants: null,
      ...over,
    });

    it('devuelve una fila por variante con su stock en destino', async () => {
      orgPrisma.stock_levels.findMany
        .mockResolvedValueOnce([
          sl({
            product_variant_id: 10,
            quantity_available: 4,
            product_variants: { id: 10, name: 'Roja', sku: 'CAM-R' },
          }),
          sl({
            product_variant_id: 11,
            quantity_available: 2,
            product_variants: { id: 11, name: 'Azul', sku: 'CAM-A' },
          }),
          // Fila base vacía de un producto con variantes: no se ofrece.
          sl({ quantity_on_hand: 0, quantity_available: 0 }),
        ])
        .mockResolvedValueOnce([
          sl({ location_id: 9, product_variant_id: 11, quantity_available: 7 }),
        ]);

      const rows = await service.searchTransferableProducts('cam', 7, 9, 20);

      const where = orgPrisma.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.location_id).toBe(7);
      expect(where.OR).toHaveLength(4);
      expect(
        rows.map((r) => ({
          v: r.product_variant_id,
          sku: r.sku,
          origin: r.stock_at_origin.quantity_available,
          dest: r.stock_at_destination.quantity_available,
        })),
      ).toEqual([
        { v: 10, sku: 'CAM-R', origin: 4, dest: 0 },
        { v: 11, sku: 'CAM-A', origin: 2, dest: 7 },
      ]);
    });

    it('valida que ambas ubicaciones sean de la organización', async () => {
      orgPrisma.stock_levels.findMany.mockResolvedValue([]);
      await service.searchTransferableProducts('', 7, 9);
      expect(operatingScope.enforceLocationAccess).toHaveBeenCalledTimes(2);
      expect(orgPrisma.stock_levels.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
