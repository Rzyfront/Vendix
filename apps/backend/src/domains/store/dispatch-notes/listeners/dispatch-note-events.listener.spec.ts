import { DispatchNoteEventsListener } from './dispatch-note-events.listener';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';

/**
 * Tests for {@link DispatchNoteEventsListener.handleDelivered} after the
 * stock-commit unification.
 *
 * Regla dura: prohibido doble consumo de stock. Toda la deducción de una
 * entrega por remisión ahora se enruta por el servicio canónico
 * {@link OrderStockCommitService.commitDispatchDelivery} — el MISMO camino que
 * order-flow / POS. El listener ya NO deduce stock directamente
 * (`updateStock`/`releaseReservationsByReference` salieron de aquí); su único
 * trabajo extra es:
 *   1. un guard anti re-deducción para remisiones STANDALONE (sin orden ni SO),
 *      cuya idempotencia no se puede marcar por `order_items` y se infiere del
 *      estado de sus `stock_reservations` (active=0 && consumed>0 ⇒ re-disparo),
 *   2. sincronizar el estado del documento padre (`checkAndUpdate*Status`),
 *   3. transicionar seriales a `sold` (`markDispatchSerialsSold`).
 *
 * Estas pruebas verifican la DELEGACIÓN al canónico y el guard standalone.
 */
describe('DispatchNoteEventsListener — handleDelivered → OrderStockCommitService delegation', () => {
  let listener: DispatchNoteEventsListener;
  let prismaMock: any;
  let stockLevelManagerMock: any;
  let orderStockCommitMock: any;

  const DISPATCHED_QTY = 5;

  /** dispatch_note ligada a orden (order_id set, sales_order_id null). */
  const buildOrderLinkedDispatchNote = () => ({
    id: 900,
    dispatch_number: 'REM-1',
    store_id: 100,
    sales_order_id: null,
    order_id: 7777,
    dispatch_location_id: 10,
    dispatch_note_items: [
      {
        id: 1,
        product_id: 1,
        product_variant_id: null,
        location_id: 10,
        dispatched_quantity: DISPATCHED_QTY,
      },
    ],
  });

  /** dispatch_note ligada a sales order (sales_order_id set, order_id null). */
  const buildSalesOrderLinkedDispatchNote = () => ({
    ...buildOrderLinkedDispatchNote(),
    sales_order_id: 5000,
    order_id: null,
  });

  /** dispatch_note STANDALONE (ni orden ni sales order). */
  const buildStandaloneDispatchNote = () => ({
    ...buildOrderLinkedDispatchNote(),
    sales_order_id: null,
    order_id: null,
  });

  beforeEach(() => {
    prismaMock = {
      dispatch_notes: {
        findFirst: jest.fn(),
      },
      // withoutScope() debe devolver el mismo mock para que
      // `this.prisma.withoutScope().stock_reservations.count(...)` resuelva.
      withoutScope: jest.fn(() => prismaMock),
      stock_reservations: {
        count: jest.fn().mockResolvedValue(0),
      },
      // checkAndUpdateOrderStatus lee orders.findFirst — null ⇒ no-op.
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      // checkAndUpdateSalesOrderStatus lee sales_orders.findFirst — null ⇒ no-op.
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

    orderStockCommitMock = {
      commitDispatchDelivery: jest
        .fn()
        .mockResolvedValue({ totalCost: 0, committedItemCount: 1 }),
    };

    // Construcción de 3 args: el 4º (InventorySerialNumbersService) es opcional
    // → markDispatchSerialsSold hace no-op cuando `serials` es undefined.
    listener = new DispatchNoteEventsListener(
      prismaMock as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      orderStockCommitMock as unknown as OrderStockCommitService,
    );
  });

  it('(a) order-linked: delega en commitDispatchDelivery con opts stock_out no-bloqueante y NO deduce stock directamente', async () => {
    const note = buildOrderLinkedDispatchNote();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: 7777,
      sales_order_id: null,
    });

    // Toda la deducción va por el canónico, una sola vez, con el contrato fijo.
    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledTimes(1);
    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        movementType: 'stock_out',
        blockOnInsufficient: false,
        consumeSerials: false,
      }),
    );
    // El listener ya NO toca el stock manager directamente.
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
    expect(
      stockLevelManagerMock.releaseReservationsByReference,
    ).not.toHaveBeenCalled();
    // El guard standalone NO aplica cuando hay order_id → sin conteo de reservas.
    expect(prismaMock.stock_reservations.count).not.toHaveBeenCalled();
  });

  it('(b) sales-order-linked: delega en commitDispatchDelivery (sin guard standalone)', async () => {
    const note = buildSalesOrderLinkedDispatchNote();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: null,
      sales_order_id: 5000,
    });

    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledTimes(1);
    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        movementType: 'stock_out',
        blockOnInsufficient: false,
        consumeSerials: false,
      }),
    );
    // sales_order_id presente → guard standalone NO aplica.
    expect(prismaMock.stock_reservations.count).not.toHaveBeenCalled();
  });

  it('(c) standalone re-disparo: reservas ya consumidas (active=0, consumed>0) ⇒ NO vuelve a deducir', async () => {
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(
      buildStandaloneDispatchNote(),
    );
    // active=0 && consumed>0 → marcador de re-disparo del caso standalone.
    prismaMock.stock_reservations.count.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.status === 'active' ? 0 : 3),
    );

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: null,
      sales_order_id: null,
    });

    // Guard evaluado contra la referencia = dispatch_note.id (900).
    expect(prismaMock.stock_reservations.count).toHaveBeenCalledWith({
      where: {
        reserved_for_type: 'order',
        reserved_for_id: 900,
        status: 'active',
      },
    });
    // Early-return: NO se delega la deducción → sin doble descuento.
    expect(orderStockCommitMock.commitDispatchDelivery).not.toHaveBeenCalled();
  });

  it('(d) standalone primer disparo: hay reservas activas (active>0) ⇒ delega en commitDispatchDelivery', async () => {
    const note = buildStandaloneDispatchNote();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);
    prismaMock.stock_reservations.count.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.status === 'active' ? 2 : 0),
    );

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: null,
      sales_order_id: null,
    });

    // No es re-disparo (active>0) → deduce vía canónico exactamente una vez.
    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledTimes(1);
    expect(orderStockCommitMock.commitDispatchDelivery).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        movementType: 'stock_out',
        blockOnInsufficient: false,
        consumeSerials: false,
      }),
    );
  });

  it('(e) remisión inexistente: no delega ni toca stock', async () => {
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(null);

    await listener.handleDelivered({
      dispatch_note_id: 900,
      dispatch_number: 'REM-1',
      store_id: 100,
      order_id: 7777,
      sales_order_id: null,
    });

    expect(orderStockCommitMock.commitDispatchDelivery).not.toHaveBeenCalled();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
  });
});
