import {
  StockLevelManager,
  type ReservationRefType,
} from './stock-level-manager.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * QUI-557 — Piso duro: una reserva no puede escribir un disponible negativo.
 *
 * `reserveStock` valida existencias solo cuando `validate_availability` es
 * `true`, pero el paso que muta `stock_levels` resta siempre. Con el flag en
 * `false` una reserva sobre una identidad sin unidades dejaba la fila en
 * `quantity_available = -N`, y ese negativo contamina toda lectura posterior
 * de la bodega: el gate de la remisión hereda el faltante y reporta "sin
 * stock" a órdenes que no tienen nada que ver con la que sobrevendió.
 *
 * El flag `validate_availability = false` se usaba con dos intenciones que no
 * distinguía: "ya validé arriba" (checkout, payments, listener de remisiones)
 * y "vender igual" (POS, cobro de orden). Solo la segunda es oversell
 * deliberado, así que ahora se declara con `allow_negative_available`.
 */
describe('StockLevelManager.reserveStock — disponible negativo (QUI-557)', () => {
  let service: StockLevelManager;
  let prismaMock: any;

  const PRODUCT_ID = 270;
  const LOCATION_ID = 50;

  /** Fila sin existencias: cualquier reserva la empujaría bajo cero. */
  const emptyStockLevel = {
    id: 1351,
    product_id: PRODUCT_ID,
    product_variant_id: null,
    location_id: LOCATION_ID,
    quantity_on_hand: 0,
    quantity_reserved: 0,
    quantity_available: 0,
  };

  /**
   * Llama a reserveStock con la firma posicional completa. `qty` es lo que se
   * reserva; `allowNegative` es el nuevo opt-in del caller. `refType` por
   * defecto es `'order'` porque las pruebas del PISO (que deben fallar con
   * INV_STOCK_001) son exactamente sobre órdenes — el caso que este plan
   * protege. La única prueba que ejerce `allowNegative: true` pasa un
   * `refType` distinto de `'order'` a propósito: ver el comentario en esa
   * prueba.
   */
  const reserve = (
    qty: number,
    allowNegative: boolean,
    refType: ReservationRefType = 'order',
  ) =>
    service.reserveStock(
      PRODUCT_ID,
      undefined, // variant_id
      LOCATION_ID,
      qty,
      refType,
      608, // reserved_for_id
      1, // user_id
      false, // validate_availability — el caso que dejaba pasar el negativo
      undefined, // tx
      undefined, // expires_at
      false, // skip_reservation
      undefined, // stock_units_consumed
      allowNegative,
    );

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 1,
      store_id: 10,
      user_id: 1,
    } as any);

    prismaMock = {
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue(emptyStockLevel),
        update: jest.fn().mockResolvedValue(emptyStockLevel),
      },
      stock_reservations: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      products: { findFirst: jest.fn(), update: jest.fn() },
      product_variants: { update: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    service = new StockLevelManager(
      prismaMock,
      {} as any, // transactionsService
      { emit: jest.fn() } as any,
      {} as any, // operatingScopeService
      {} as any, // costingService
      {} as any, // costingMethodResolver
    );

    // `syncProductStock` agrega sobre otras tablas y no es lo que se prueba.
    jest
      .spyOn(service as any, 'syncProductStock')
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(service as any, 'getOrCreateStockLevel')
      .mockResolvedValue(emptyStockLevel as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('falla con INV_STOCK_001 antes de escribir un disponible negativo', async () => {
    await expect(reserve(1, false)).rejects.toBeInstanceOf(
      VendixHttpException,
    );

    // Lo importante: no dejó rastro. Ni reserva ni fila mutada.
    expect(prismaMock.stock_reservations.create).not.toHaveBeenCalled();
    expect(prismaMock.stock_levels.update).not.toHaveBeenCalled();
  });

  it('reporta el código de error y la cifra que habría quedado', async () => {
    try {
      await reserve(3, false);
      fail('debió lanzar');
    } catch (err) {
      const body = (err as VendixHttpException).getResponse() as any;
      expect(body.error_code).toBe('INV_STOCK_001');
      // 0 - 3 = -3; el mensaje nombra la cifra para que el operador la vea.
      expect(body.message).toContain('-3');
    }
  });

  it('el flag allow_negative_available sigue existiendo para su caso de uso original (no ORDER)', async () => {
    // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md):
    // el objetivo global es que una ORDEN nunca sobrevenda, así que esta
    // prueba NO ejerce `reserved_for_type: 'order'` — lo haría deseable un
    // disponible negativo justo en el caso que el plan cierra. El flag
    // `allow_negative_available` sigue siendo un parámetro real del método
    // (otros callers ya autorizados, ver comentario de `reserveStock`, lo
    // siguen pasando); esta prueba solo prueba que el mecanismo del flag
    // sigue vivo, con una referencia neutra ('transfer').
    await expect(reserve(2, true, 'transfer')).resolves.toBeUndefined();

    expect(prismaMock.stock_reservations.create).toHaveBeenCalled();
    expect(prismaMock.stock_levels.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity_reserved: 2,
          quantity_available: -2,
        }),
      }),
    );
  });

  it('no interfiere con una reserva que sí tiene existencias', async () => {
    const stocked = {
      ...emptyStockLevel,
      quantity_on_hand: 40,
      quantity_available: 40,
    };
    jest
      .spyOn(service as any, 'getOrCreateStockLevel')
      .mockResolvedValue(stocked as any);

    await expect(reserve(25, false)).resolves.toBeUndefined();

    expect(prismaMock.stock_levels.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity_available: 15 }),
      }),
    );
  });
});
