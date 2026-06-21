import { DispatchNoteEventsListener } from './dispatch-note-events.listener';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';

/**
 * Tests for the anti double-deduction gate in {@link DispatchNoteEventsListener.handleDelivered}.
 *
 * Regla dura: prohibido doble consumo de stock. La única fuente de verdad es la
 * reserva (`stock_reservations` activas). Si la reserva ya fue consumida por
 * otro camino (order-flow finished) o el evento se re-dispara, el listener NO
 * debe volver a deducir stock. Espejo de order-flow.service.ts:241-253.
 */
describe('DispatchNoteEventsListener — handleDelivered anti double-deduction gate', () => {
  let listener: DispatchNoteEventsListener;
  let prismaMock: any;
  let stockLevelManagerMock: any;

  const DISPATCHED_QTY = 5;

  /**
   * dispatch_note order-linked (order_id, sales_order_id:null) con 1 item.
   */
  const buildOrderLinkedDispatchNote = () => ({
    id: 900,
    dispatch_number: 'REM-1',
    store_id: 100,
    sales_order_id: null,
    order_id: 7777,
    dispatch_location_id: 10,
    dispatch_note_items: [
      {
        product_id: 1,
        product_variant_id: null,
        location_id: 10,
        dispatched_quantity: DISPATCHED_QTY,
      },
    ],
  });

  /**
   * dispatch_note sales-order-linked (sales_order_id set, order_id:null).
   */
  const buildSalesOrderLinkedDispatchNote = () => ({
    ...buildOrderLinkedDispatchNote(),
    sales_order_id: 5000,
    order_id: null,
  });

  beforeEach(() => {
    prismaMock = {
      dispatch_notes: {
        findFirst: jest.fn(),
      },
      // withoutScope() must return the same mock so that
      // `this.prisma.withoutScope().stock_reservations.count(...)` resolves.
      withoutScope: jest.fn(() => prismaMock),
      stock_reservations: {
        count: jest.fn(),
      },
      // checkAndUpdateOrderStatus() reads orders.findFirst — returning null
      // makes the order-status sync a no-op so it never throws in tests.
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      // checkAndUpdateSalesOrderStatus() reads sales_orders.findFirst — same
      // no-op strategy. Not exercised by these tests (sales_order_id is null)
      // but mocked defensively.
      sales_orders: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    stockLevelManagerMock = {
      updateStock: jest.fn().mockResolvedValue({}),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      reserveStock: jest.fn().mockResolvedValue(undefined),
    };

    listener = new DispatchNoteEventsListener(
      prismaMock as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
    );
  });

  it('(k) NO vuelve a deducir stock cuando ya no hay reservas activas (activeReservations=0)', async () => {
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(
      buildOrderLinkedDispatchNote(),
    );
    // La reserva ya fue consumida por otro camino -> 0 reservas activas.
    prismaMock.stock_reservations.count.mockResolvedValue(0);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: 7777,
      sales_order_id: null,
    });

    // PASO 1 omitido: NO se deduce stock para evitar doble consumo.
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(0);
    // El conteo se hizo contra la referencia del pedido (order_id).
    expect(prismaMock.withoutScope).toHaveBeenCalled();
    expect(prismaMock.stock_reservations.count).toHaveBeenCalledWith({
      where: {
        reserved_for_type: 'order',
        reserved_for_id: 7777,
        status: 'active',
      },
    });
  });

  it('(l) deduce stock normalmente cuando hay reservas activas (activeReservations>0)', async () => {
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(
      buildOrderLinkedDispatchNote(),
    );
    // Hay reservas activas -> camino normal de deducción.
    prismaMock.stock_reservations.count.mockResolvedValue(2);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: 7777,
      sales_order_id: null,
    });

    // PASO 1 ejecutado: 1 deducción por el único item, con stock_out negativo.
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        movement_type: 'stock_out',
        quantity_change: -DISPATCHED_QTY,
      }),
    );

    // PASO 3 (order-linked): release idempotente con decrementOnHand:false para
    // no volver a tocar quantity_on_hand (ya lo hizo updateStock arriba).
    expect(
      stockLevelManagerMock.releaseReservationsByReference,
    ).toHaveBeenCalledWith(
      'order',
      7777,
      'consumed',
      undefined,
      expect.objectContaining({ decrementOnHand: false }),
    );
  });

  it('(m) SO-linked: deduce 1× y consume con decrementOnHand:false (sin doble deducción)', async () => {
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(
      buildSalesOrderLinkedDispatchNote(),
    );
    prismaMock.stock_reservations.count.mockResolvedValue(3);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: null,
      sales_order_id: 5000,
    });

    // El conteo usa sales_order_id como referencia de reserva.
    expect(prismaMock.stock_reservations.count).toHaveBeenCalledWith({
      where: {
        reserved_for_type: 'order',
        reserved_for_id: 5000,
        status: 'active',
      },
    });
    // PASO 1: una sola deducción stock_out por el item.
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
    // PASO 2 (SO branch): release consume SIN re-decrementar quantity_on_hand
    // (el loop ya lo hizo) — fix anti doble-deducción consistente con order branch.
    expect(
      stockLevelManagerMock.releaseReservationsByReference,
    ).toHaveBeenCalledWith(
      'order',
      5000,
      'consumed',
      undefined,
      expect.objectContaining({ decrementOnHand: false }),
    );
  });
});
