import {
  StockValidatorService,
  StockDemandLine,
} from './stock-validator.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from './stock-level-manager.service';
import { SellableStockAllocator } from './sellable-stock-allocator.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md).
 *
 * `assertLinesAvailable`/`assertIngredientsAvailable` comparten el mismo
 * núcleo no-throwing `findInsufficientLines`, que reutiliza EXACTAMENTE el
 * mismo alcance vendible (`SellableStockAllocator.getSellableLevels`) que usa
 * la reserva/commit real (QUI-559) — nunca un agregado propio.
 *
 * Regla dura de estas pruebas (skill `vendix-known-errors`): el rechazo se
 * ancla al `errorCode`/`error_code`, nunca solo a `toBeInstanceOf`.
 */
describe('StockValidatorService — no-overselling guard', () => {
  let service: StockValidatorService;
  let prismaMock: any;
  let allocatorMock: any;

  const PRODUCT_A = 501; // MODELO
  const STORE_ID = 7;

  beforeEach(() => {
    prismaMock = {
      products: { findMany: jest.fn() },
      product_variants: { findMany: jest.fn().mockResolvedValue([]) },
      stock_reservations: { aggregate: jest.fn() },
    };

    allocatorMock = {
      getSellableLevels: jest.fn(),
    };

    service = new StockValidatorService(
      prismaMock as unknown as StorePrismaService,
      {} as unknown as StockLevelManager,
      allocatorMock as unknown as SellableStockAllocator,
    );
  });

  describe('assertLinesAvailable', () => {
    it('producto tracked sin stock lanza INV_STOCK_INSUFFICIENT_LINES nombrando el producto', async () => {
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: PRODUCT_A,
          store_id: STORE_ID,
          track_inventory: true,
          product_type: 'physical',
          name: 'MODELO',
        },
      ]);
      allocatorMock.getSellableLevels.mockResolvedValue([]);

      const lines: StockDemandLine[] = [{ product_id: PRODUCT_A, quantity: 1 }];

      await expect(service.assertLinesAvailable(lines)).rejects.toMatchObject({
        errorCode: 'INV_STOCK_INSUFFICIENT_LINES',
      });

      try {
        await service.assertLinesAvailable(lines);
        fail('debió lanzar');
      } catch (err) {
        const body = (err as VendixHttpException).getResponse() as any;
        expect(body.error_code).toBe('INV_STOCK_INSUFFICIENT_LINES');
        expect(body.details.items).toEqual([
          expect.objectContaining({
            product_id: PRODUCT_A,
            product_variant_id: null,
            product_name: 'MODELO',
            kind: 'product',
            requested: 1,
            available: 0,
          }),
        ]);
      }
    });

    it('producto sin tracking (track_inventory=false) nunca bloquea, aunque no haya stock', async () => {
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: PRODUCT_A,
          store_id: STORE_ID,
          track_inventory: false,
          product_type: 'physical',
          name: 'MODELO',
        },
      ]);

      await expect(
        service.assertLinesAvailable([
          { product_id: PRODUCT_A, quantity: 999 },
        ]),
      ).resolves.toBeUndefined();

      // Ni siquiera se consulta disponibilidad: un producto sin tracking es
      // ilimitado por definición (`vendix-product-variants`).
      expect(allocatorMock.getSellableLevels).not.toHaveBeenCalled();
    });

    it('la reserva propia de la orden cuenta como disponible', async () => {
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: PRODUCT_A,
          store_id: STORE_ID,
          track_inventory: true,
          product_type: 'physical',
          name: 'MODELO',
        },
      ]);
      allocatorMock.getSellableLevels.mockResolvedValue([
        { location_id: 1, quantity_available: 0 },
      ]);
      prismaMock.stock_reservations.aggregate.mockResolvedValue({
        _sum: { quantity: 2 },
      });

      await expect(
        service.assertLinesAvailable(
          [{ product_id: PRODUCT_A, quantity: 2 }],
          { orderId: 900 },
        ),
      ).resolves.toBeUndefined();

      expect(prismaMock.stock_reservations.aggregate).toHaveBeenCalledWith({
        where: {
          reserved_for_type: 'order',
          reserved_for_id: 900,
          product_id: PRODUCT_A,
          product_variant_id: null,
          status: 'active',
        },
        _sum: { quantity: true },
      });
    });

    it('dos líneas del mismo producto se agregan antes de comparar contra disponible', async () => {
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: PRODUCT_A,
          store_id: STORE_ID,
          track_inventory: true,
          product_type: 'physical',
          name: 'MODELO',
        },
      ]);
      allocatorMock.getSellableLevels.mockResolvedValue([
        { location_id: 1, quantity_available: 1 },
      ]);

      await expect(
        service.assertLinesAvailable([
          { product_id: PRODUCT_A, quantity: 1 },
          { product_id: PRODUCT_A, quantity: 1 },
        ]),
      ).rejects.toMatchObject({ errorCode: 'INV_STOCK_INSUFFICIENT_LINES' });

      // Una sola lectura de niveles por identidad AGREGADA, no una por línea.
      expect(allocatorMock.getSellableLevels).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertIngredientsAvailable', () => {
    it('insumo compartido por dos platos se agrega y reporta ambos en used_by', async () => {
      const LIMON = 900;
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: LIMON,
          store_id: STORE_ID,
          track_inventory: true,
          product_type: 'physical',
          name: 'Limón',
        },
      ]);
      allocatorMock.getSellableLevels.mockResolvedValue([
        { location_id: 1, quantity_available: 1 },
      ]);

      const demands: StockDemandLine[] = [
        { product_id: LIMON, quantity: 2, used_by: 'Mojito' },
        { product_id: LIMON, quantity: 1, used_by: 'Limonada' },
      ];

      try {
        await service.assertIngredientsAvailable(demands);
        fail('debió lanzar');
      } catch (err) {
        expect((err as VendixHttpException).errorCode).toBe(
          'INV_STOCK_INSUFFICIENT_LINES',
        );
        const body = (err as VendixHttpException).getResponse() as any;
        expect(body.details.items).toEqual([
          expect.objectContaining({
            product_id: LIMON,
            kind: 'ingredient',
            requested: 3,
            available: 1,
            used_by: ['Mojito', 'Limonada'],
          }),
        ]);
      }

      // Sin orderId nunca — assertIngredientsAvailable no lo acepta.
      expect(prismaMock.stock_reservations.aggregate).not.toHaveBeenCalled();
    });
  });
});
