import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LayawayService } from './layaway.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * D-2.1 (P0) — entregar un separado movía el físico sin dejar rastro.
 *
 * Al completarse el plan, el cierre de reservas bajaba `quantity_on_hand`
 * escribiendo DIRECTO en `stock_levels`: el saldo quedaba bien, pero no nacía
 * `inventory_movements` ni `inventory_transactions`, no se consumía capa de
 * costo y la venta no tenía costo de ventas. El contador veía inventario que
 * bajó sin un solo documento que lo explique.
 *
 * El fix consume cada reserva por el motor canónico (`updateStock`, que es donde
 * nacen el movimiento y el consumo de capa) y sólo DESPUÉS cierra las reservas
 * con `decrementOnHand: false`, para no descontar dos veces.
 *
 * Dato que valida el enfoque: `stock_reservations.quantity` ya guarda unidades
 * de stock, así que consumir la reserva directo es correcto — el defecto era el
 * camino, no el número.
 */
describe('LayawayService — consumo de stock al entregar', () => {
  let service: LayawayService;
  let stockLevelManager: {
    updateStock: jest.Mock;
    releaseReservationsByReference: jest.Mock;
  };
  let tx: { stock_reservations: { findMany: jest.Mock } };

  const PLAN = { id: 42, plan_number: 'SEP-0042' };

  const reserva = (over: Record<string, unknown> = {}) => ({
    id: 1,
    product_id: 100,
    product_variant_id: null,
    location_id: 5,
    quantity: 50,
    ...over,
  });

  beforeEach(async () => {
    stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue(undefined),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    tx = { stock_reservations: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LayawayService,
        { provide: StorePrismaService, useValue: {} },
        { provide: StockLevelManager, useValue: stockLevelManager },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(LayawayService);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** El método es privado a propósito: sólo lo invocan los dos cierres del plan. */
  const consumir = () =>
    (
      service as unknown as {
        consumeReservedStock: (p: typeof PLAN, t: unknown) => Promise<void>;
      }
    ).consumeReservedStock(PLAN, tx);

  it('EL DEFECTO: la entrega pasa por el motor de stock y deja movimiento', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([reserva()]);

    await consumir();

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    const [params, txArg] = stockLevelManager.updateStock.mock.calls[0];
    expect(params).toMatchObject({
      product_id: 100,
      location_id: 5,
      quantity_change: -50,
      movement_type: 'sale',
      source_module: 'layaway',
      // Ésta es la bandera que hace nacer la fila de Kardex.
      create_movement: true,
    });
    // Se ejecuta DENTRO de la transacción del cierre del plan.
    expect(txArg).toBe(tx);
  });

  it('no vuelve a validar disponibilidad: el stock ya está reservado', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([reserva()]);

    await consumir();

    // Validarla acá rechazaría la entrega justamente porque está reservada.
    expect(stockLevelManager.updateStock.mock.calls[0][0]).toMatchObject({
      validate_availability: false,
    });
  });

  it('cierra las reservas SIN descontar de nuevo', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([reserva()]);

    await consumir();

    expect(
      stockLevelManager.releaseReservationsByReference,
    ).toHaveBeenCalledWith('layaway', PLAN.id, 'consumed', tx, {
      decrementOnHand: false,
    });
  });

  it('descuenta de la bodega donde estaba reservado, una línea por reserva', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([
      reserva({ id: 1, product_id: 100, location_id: 5, quantity: 50 }),
      reserva({
        id: 2,
        product_id: 200,
        product_variant_id: 77,
        location_id: 8,
        quantity: 3,
      }),
    ]);

    await consumir();

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(2);
    expect(stockLevelManager.updateStock.mock.calls[0][0]).toMatchObject({
      product_id: 100,
      location_id: 5,
      quantity_change: -50,
      variant_id: undefined,
    });
    expect(stockLevelManager.updateStock.mock.calls[1][0]).toMatchObject({
      product_id: 200,
      variant_id: 77,
      location_id: 8,
      quantity_change: -3,
    });
  });

  it('sólo consume reservas activas de ESTE plan', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([]);

    await consumir();

    expect(tx.stock_reservations.findMany).toHaveBeenCalledWith({
      where: {
        reserved_for_type: 'layaway',
        reserved_for_id: PLAN.id,
        status: 'active',
      },
    });
  });

  it('una reserva sin cantidad no genera movimiento vacío', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([
      reserva({ quantity: 0 }),
      reserva({ id: 2, quantity: null }),
    ]);

    await consumir();

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    // Pero las reservas sí se cierran: dejarlas activas bloquearía stock.
    expect(
      stockLevelManager.releaseReservationsByReference,
    ).toHaveBeenCalledTimes(1);
  });

  it('sin reservas no escribe stock pero igual cierra el barrido', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([]);

    await consumir();

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(
      stockLevelManager.releaseReservationsByReference,
    ).toHaveBeenCalledTimes(1);
  });

  it('el motivo del movimiento identifica el plan para la auditoría', async () => {
    tx.stock_reservations.findMany.mockResolvedValue([reserva()]);

    await consumir();

    expect(stockLevelManager.updateStock.mock.calls[0][0].reason).toContain(
      'SEP-0042',
    );
  });
});
