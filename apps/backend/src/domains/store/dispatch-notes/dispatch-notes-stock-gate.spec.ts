import { DispatchNotesService } from './dispatch-notes.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * QUI-557 — "La remisión dice 'sin stock' cuando sí hay".
 *
 * El gate de existencias de la remisión fallaba de dos maneras distintas y
 * estas pruebas fijan ambas:
 *
 *  1. LEÍA LA FILA EQUIVOCADA. `getStockLevels` omitía el filtro de variante
 *     para las líneas base, así que devolvía la fila base MÁS todas las de
 *     variantes, y `getStockLevelAtLocation` elegía una arbitraria (sin
 *     `orderBy`, en orden de heap de Postgres). Una orden de 25 unidades con
 *     40 en la base se rechazaba reportando las 18 de una variante. El fix
 *     vive en `StockValidatorService`; aquí se fija el contrato que consume
 *     la remisión: lo reservado PARA ESTA ORDEN cuenta como despachable.
 *
 *  2. COLAPSABA CUATRO SITUACIONES EN UN MENSAJE. Sin stock, reservado por
 *     otras órdenes, línea sin variante y bodega sin resolver piden acciones
 *     distintas del operador (comprar, liberar, corregir la orden,
 *     configurar la tienda). Decir "no hay stock suficiente" en los cuatro
 *     casos es lo que volvió bloqueante el ticket: mandaba a revisar el lugar
 *     equivocado.
 *
 * Además `location_unresolved` cierra un hueco real: antes la validación hacía
 * `continue` cuando la bodega venía en `null`, así que una tienda sin
 * `default_location_id` confirmaba remisiones SIN validar existencias.
 */
describe('DispatchNotesService — gate de stock de la remisión (QUI-557)', () => {
  let service: DispatchNotesService;
  let prismaMock: any;
  let stockValidatorMock: any;

  const STORE_ID = 100;
  const USER_ID = 1;
  const ORDER_ID = 590;
  const PRODUCT_ID = 352;
  const LOCATION_ID = 50;

  /**
   * Arma el mundo mínimo que `validateDispatchItemsStock` consulta.
   * `available` es lo que devuelve `validateAvailability` (ya neto de
   * reservas); `reservedForOrder` es lo apartado para ESTA orden.
   */
  const setupStock = (opts: {
    onHand: number;
    reservedTotal: number;
    reservedForOrder: number;
    available: number;
    variantAvailableAtLocation?: number;
  }) => {
    stockValidatorMock.doesProductTrackInventory.mockResolvedValue(true);
    stockValidatorMock.validateAvailability.mockResolvedValue({
      available: opts.available,
    });
    prismaMock.products.findFirst.mockResolvedValue({ name: 'Camiseta' });
    prismaMock.inventory_locations.findFirst.mockResolvedValue({
      name: 'Bodega Principal',
    });
    prismaMock.stock_levels.findFirst.mockResolvedValue({
      quantity_on_hand: opts.onHand,
      quantity_reserved: opts.reservedTotal,
    });
    prismaMock.stock_reservations.aggregate.mockResolvedValue({
      _sum: { quantity: opts.reservedForOrder },
    });
    prismaMock.stock_levels.aggregate.mockResolvedValue({
      _sum: { quantity_available: opts.variantAvailableAtLocation ?? 0 },
    });
  };

  const baseItem = (dispatched_quantity: number, location_id = LOCATION_ID) => ({
    product_id: PRODUCT_ID,
    product_variant_id: null,
    location_id,
    dispatched_quantity,
  });

  /** Ejecuta el gate y devuelve el primer ítem bloqueado, o null si pasó. */
  const runGate = async (items: any[]) => {
    try {
      await (service as any).validateDispatchItemsStock(
        STORE_ID,
        ORDER_ID,
        items,
      );
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(VendixHttpException);
      // `details` viaja en el body de la HttpException, no como propiedad.
      const body = (err as VendixHttpException).getResponse() as any;
      return body.details.items[0];
    }
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);

    prismaMock = {
      products: { findFirst: jest.fn() },
      inventory_locations: { findFirst: jest.fn() },
      stock_levels: { findFirst: jest.fn(), aggregate: jest.fn() },
      stock_reservations: { findFirst: jest.fn(), aggregate: jest.fn() },
    };

    stockValidatorMock = {
      doesProductTrackInventory: jest.fn(),
      validateAvailability: jest.fn(),
    };

    service = new DispatchNotesService(
      prismaMock,
      { generateNextNumber: jest.fn() } as any,
      {} as any, // routeNumberGenerator
      { emit: jest.fn() } as any,
      stockValidatorMock,
      {} as any, // aiEngine
      {} as any, // receiptScanQueue
      { recomputeOrderFulfillment: jest.fn() } as any, // dispatchFulfillment
      undefined as any, // purchaseOrdersService (optional)
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('validateDispatchItemsStock', () => {
    it('no bloquea cuando lo reservado para ESTA orden cubre lo despachado', async () => {
      // El caso exacto del ticket: 25 unidades, todas apartadas para la orden.
      // `available` ya está en 0 justamente porque la reserva las descontó.
      setupStock({
        onHand: 40,
        reservedTotal: 25,
        reservedForOrder: 25,
        available: 0,
      });

      expect(await runGate([baseItem(25)])).toBeNull();
    });

    it('clasifica como reserved_by_others cuando hay unidades físicas pero apartadas para otras órdenes', async () => {
      // 40 en bodega, 38 reservadas por otra orden, esta pide 10.
      // Hay existencias: la acción es liberar o priorizar, NO comprar.
      setupStock({
        onHand: 40,
        reservedTotal: 38,
        reservedForOrder: 0,
        available: 2,
      });

      const blocked = await runGate([baseItem(10)]);

      expect(blocked.reason).toBe('reserved_by_others');
      expect(blocked.reserved_by_others).toBe(38);
      expect(blocked.on_hand).toBe(40);
      expect(blocked.requested).toBe(10);
      expect(blocked.location_name).toBe('Bodega Principal');
    });

    it('clasifica como variant_required cuando la línea base está en cero y el stock vive en las variantes', async () => {
      // La identidad base no tiene unidades, pero las variantes en esa misma
      // bodega sí. Una variante no es despachable como producto base: el
      // arreglo es corregir la línea de la orden.
      setupStock({
        onHand: 0,
        reservedTotal: 0,
        reservedForOrder: 0,
        available: 0,
        variantAvailableAtLocation: 15,
      });

      const blocked = await runGate([baseItem(1)]);

      expect(blocked.reason).toBe('variant_required');
    });

    it('clasifica como no_stock cuando tampoco hay existencias en las variantes', async () => {
      setupStock({
        onHand: 3,
        reservedTotal: 0,
        reservedForOrder: 0,
        available: 3,
        variantAvailableAtLocation: 0,
      });

      const blocked = await runGate([baseItem(10)]);

      expect(blocked.reason).toBe('no_stock');
      expect(blocked.available).toBe(3);
    });

    it('bloquea con location_unresolved en vez de saltarse la validación cuando no hay bodega', async () => {
      // Antes esto era un `continue` silencioso: la tienda sin
      // `default_location_id` confirmaba remisiones sin validar nada.
      stockValidatorMock.doesProductTrackInventory.mockResolvedValue(true);
      prismaMock.products.findFirst.mockResolvedValue({ name: 'Camiseta' });

      const blocked = await runGate([baseItem(5, null as any)]);

      expect(blocked.reason).toBe('location_unresolved');
      expect(blocked.location_id).toBeNull();
      // No debe haberse consultado disponibilidad: no hay contra qué validar.
      expect(stockValidatorMock.validateAvailability).not.toHaveBeenCalled();
    });

    it('ignora los productos que no llevan inventario', async () => {
      stockValidatorMock.doesProductTrackInventory.mockResolvedValue(false);

      expect(await runGate([baseItem(999)])).toBeNull();
      expect(stockValidatorMock.validateAvailability).not.toHaveBeenCalled();
    });
  });

  describe('resolveItemDispatchLocation', () => {
    it('despacha desde la bodega donde está la reserva de esa identidad, no desde la de la orden', async () => {
      // Órdenes multi-bodega: resolver a nivel orden mandaba todas las líneas
      // a la bodega de la primera reserva.
      prismaMock.stock_reservations.findFirst.mockResolvedValue({
        location_id: 77,
      });

      const resolved = await (service as any).resolveItemDispatchLocation(
        ORDER_ID,
        PRODUCT_ID,
        null,
        LOCATION_ID,
      );

      expect(resolved).toBe(77);
      expect(prismaMock.stock_levels.findFirst).not.toHaveBeenCalled();
    });

    it('cae a la bodega con más disponible cuando la línea no tiene reserva', async () => {
      prismaMock.stock_reservations.findFirst.mockResolvedValue(null);
      prismaMock.stock_levels.findFirst.mockResolvedValue({ location_id: 88 });

      const resolved = await (service as any).resolveItemDispatchLocation(
        ORDER_ID,
        PRODUCT_ID,
        null,
        LOCATION_ID,
      );

      expect(resolved).toBe(88);
      expect(prismaMock.stock_levels.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            product_variant_id: null,
            quantity_available: { gt: 0 },
          }),
          orderBy: { quantity_available: 'desc' },
        }),
      );
    });

    it('cae a la bodega por defecto de la orden cuando no hay ni reserva ni existencias', async () => {
      prismaMock.stock_reservations.findFirst.mockResolvedValue(null);
      prismaMock.stock_levels.findFirst.mockResolvedValue(null);

      const resolved = await (service as any).resolveItemDispatchLocation(
        ORDER_ID,
        PRODUCT_ID,
        null,
        LOCATION_ID,
      );

      expect(resolved).toBe(LOCATION_ID);
    });
  });
});
