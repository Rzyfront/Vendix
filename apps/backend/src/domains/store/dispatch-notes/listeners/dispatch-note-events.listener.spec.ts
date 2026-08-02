import { Logger } from '@nestjs/common';
import { DispatchNoteEventsListener } from './dispatch-note-events.listener';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import { VendixHttpException } from 'src/common/errors';
// Solo TIPO: `import type` garantiza que el grafo de módulos real de
// PurchaseOrdersService (pesado) nunca se cargue en este spec.
import type { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';

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

/**
 * Tests for {@link DispatchNoteEventsListener.handleReceived} — recepción de una
 * ORDEN DE COMPRA a través de una remisión (`inbound` / `purchase_receipt` con
 * `purchase_order_id`).
 *
 * Este camino respondía HTTP 200 dejando la orden de compra en `approved` — sin
 * recibir nada — por cuatro causas independientes, y la suite pasaba verde con
 * todas vivas porque `handleReceived` no tenía NINGUNA prueba:
 *
 *  1. la línea de OC se re-derivaba por producto+variante, así que dos líneas del
 *     mismo producto colapsaban en la primera y un id fijado se ignoraba;
 *  2. `receiveItems.length === 0` hacía `return` en vez de lanzar;
 *  3. los tres guards de idempotencia usaban `contains: 'remisión #N'` sin
 *     frontera, de modo que `remisión #1` casaba dentro de `remisión #12` y el
 *     guard cortaba en falso;
 *  4. el `catch` del handler se tragaba el error, así que el emisor comprometía
 *     `status = 'received'` igual.
 *
 * Contrato que fijan estas pruebas:
 *  - la línea de OC se resuelve por `purchase_order_item_id` FIJADO (verdad), y
 *    un id que no pertenece a la OC ABORTA con `DISPATCH_NOTE_PO_LINE_UNRESOLVED`;
 *  - cero líneas resolubles ABORTA con `DISPATCH_NOTE_NOTHING_RECEIVABLE`;
 *  - los guards distinguen `#1` de `#12` (token delimitado `[DN-RCP#N]` +
 *    confirmación con frontera en JS) SIN perder la idempotencia real;
 *  - el fallo de una recepción ligada a OC RE-LANZA (para que el emisor no
 *    comprometa el estado), mientras `transfer_in` / `customer_return` conservan
 *    el swallow-and-log histórico.
 */
describe('DispatchNoteEventsListener — handleReceived → recepción de OC por remisión', () => {
  let listener: DispatchNoteEventsListener;
  let prismaMock: any;
  let stockLevelManagerMock: any;
  let orderStockCommitMock: any;
  let purchaseOrdersMock: any;

  const STORE_ID = 100;
  const PO_ID = 4242;
  /**
   * id 1 A PROPÓSITO: es el id cuyo marcador legado (`remisión #1`) queda
   * contenido por substring dentro del de la remisión 12 (`remisión #12`). Toda
   * la clase de bugs de frontera se reproduce con este id.
   */
  const NOTE_ID = 1;

  /**
   * Reproduce la semántica de filtrado de Prisma que los guards usan como
   * PREFILTRO: `contains` (substring, sin frontera de palabra), `OR`/`AND` e
   * igualdad simple. Sin esto el mock devolvería lo que se le diga y la prueba de
   * colisión de substring no probaría nada: es justamente el `contains` sin
   * frontera lo que producía el falso positivo.
   */
  const matchesWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
      if (key === 'OR') {
        return (cond as any[]).some((c) => matchesWhere(row, c));
      }
      if (key === 'AND') {
        return (cond as any[]).every((c) => matchesWhere(row, c));
      }
      if (cond && typeof cond === 'object' && 'contains' in cond) {
        return (
          typeof row[key] === 'string' && row[key].includes(cond.contains)
        );
      }
      return row[key] === cond;
    });

  /**
   * Tabla en memoria con `findMany`/`findFirst` reales sobre `rows`. Se exponen
   * las dos porque el guard consulta con `findMany` (prefiltro + confirmación en
   * JS) y el resto del listener usa `findFirst`.
   */
  const makeTable = (rows: any[]) => ({
    rows,
    findMany: jest.fn(async ({ where }: any = {}) =>
      rows.filter((r) => matchesWhere(r, where)),
    ),
    findFirst: jest.fn(
      async ({ where }: any = {}) =>
        rows.find((r) => matchesWhere(r, where)) ?? null,
    ),
  });

  /**
   * Línea de la ORDEN DE COMPRA. Lleva `purchase_order_id` porque la delegación
   * consulta `purchase_order_items.findMany({ where: { purchase_order_id } })` y
   * la tabla en memoria aplica ese filtro de verdad.
   */
  const poLine = (
    id: number,
    product_id: number,
    product_variant_id: number | null = null,
  ) => ({ id, purchase_order_id: PO_ID, product_id, product_variant_id });

  /** Línea de remisión tal como la devuelve Prisma (todas las columnas leídas). */
  const buildItem = (over: Record<string, any> = {}) => ({
    id: 1,
    product_id: 1,
    product_variant_id: null,
    location_id: 10,
    dispatched_quantity: 1,
    unit_price: 1000,
    purchase_order_item_id: null,
    new_base_price: null,
    new_profit_margin: null,
    ...over,
  });

  /** Remisión inbound `purchase_receipt` ligada a la OC `PO_ID`. */
  const buildPoReceiptNote = (items: any[], over: Record<string, any> = {}) => ({
    id: NOTE_ID,
    dispatch_number: `REM-${NOTE_ID}`,
    store_id: STORE_ID,
    direction: 'inbound',
    subtype: 'purchase_receipt',
    purchase_order_id: PO_ID,
    supplier_id: 55,
    sales_order_id: null,
    order_id: null,
    from_location_id: null,
    to_location_id: 10,
    dispatch_location_id: 10,
    dispatch_note_items: items,
    ...over,
  });

  const receivedEvent = (note: any) => ({
    dispatch_note_id: note.id,
    dispatch_number: note.dispatch_number,
    store_id: note.store_id,
    direction: note.direction,
    subtype: note.subtype,
    supplier_id: note.supplier_id,
    related_dispatch_id: null,
    from_location_id: note.from_location_id,
    to_location_id: note.to_location_id,
  });

  /** Glosa + token que la delegación estampa en la recepción de la OC. */
  const RECEIPT_NOTES = `Recepción por remisión #${NOTE_ID} [DN-RCP#${NOTE_ID}]`;

  beforeEach(() => {
    // Varios casos ejercitan a propósito ramas que loguean error; silenciarlas
    // mantiene legible el resumen de jest sin alterar el comportamiento probado.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    prismaMock = {
      dispatch_notes: {
        findFirst: jest.fn(),
      },
      // Mismo contrato que el describe de handleDelivered: withoutScope()
      // devuelve el propio mock para que
      // `this.prisma.withoutScope().<model>.<op>()` resuelva.
      withoutScope: jest.fn(() => prismaMock),
      inventory_movements: makeTable([]),
      purchase_order_receptions: makeTable([]),
      purchase_order_items: makeTable([]),
      // resolveOrgId / snapshot de proveedor: sólo se alcanzan cuando
      // receivedCost > 0 (nunca en el camino ligado a OC), pero se mockean para
      // que ninguna rama quede colgada de un undefined.
      stores: {
        findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
      },
      suppliers: { findUnique: jest.fn().mockResolvedValue(null) },
      stock_reservations: { count: jest.fn().mockResolvedValue(0) },
    };

    stockLevelManagerMock = {
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: null }),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
      reserveStock: jest.fn().mockResolvedValue(undefined),
    };

    orderStockCommitMock = {
      commitDispatchDelivery: jest
        .fn()
        .mockResolvedValue({ totalCost: 0, committedItemCount: 1 }),
    };

    purchaseOrdersMock = {
      receive: jest.fn().mockResolvedValue({ id: PO_ID, status: 'received' }),
    };

    // 6 args: serials y eventEmitter quedan undefined (no-op) y
    // purchaseOrdersService SÍ se inyecta — sin él la delegación es un no-op
    // logueado y ninguno de estos casos probaría nada.
    listener = new DispatchNoteEventsListener(
      prismaMock as unknown as StorePrismaService,
      stockLevelManagerMock as unknown as StockLevelManager,
      orderStockCommitMock as unknown as OrderStockCommitService,
      undefined,
      undefined,
      purchaseOrdersMock as unknown as PurchaseOrdersService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('(f) resuelve la línea de OC por el purchase_order_item_id FIJADO, no por el adivinado desde producto/variante', async () => {
    // La OC tiene DOS líneas del mismo producto (501 y 502). La remisión fija la
    // SEGUNDA: el emparejamiento por producto habría devuelto 501.
    prismaMock.purchase_order_items.rows.push(
      poLine(501, 1),
      poLine(502, 1),
      poLine(503, 5, 77),
    );
    const note = buildPoReceiptNote([
      buildItem({
        id: 11,
        product_id: 1,
        purchase_order_item_id: 502,
        dispatched_quantity: 4,
      }),
      buildItem({
        id: 12,
        product_id: 5,
        product_variant_id: 77,
        purchase_order_item_id: 503,
        dispatched_quantity: 6,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleReceived(receivedEvent(note));

    // Ids EXACTOS de la remisión + cantidades despachadas, y la glosa con el
    // token delimitado que después leen los guards de idempotencia.
    expect(purchaseOrdersMock.receive).toHaveBeenCalledTimes(1);
    expect(purchaseOrdersMock.receive).toHaveBeenCalledWith(PO_ID, {
      items: [
        { id: 502, quantity_received: 4 },
        { id: 503, quantity_received: 6 },
      ],
      notes: RECEIPT_NOTES,
    });
    // ORDER-FIRST: el stock-in lo hace receive(), nunca este listener.
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
  });

  it('(g) dos líneas de OC del MISMO producto/variante se reciben independientes (no colapsan en la primera)', async () => {
    prismaMock.purchase_order_items.rows.push(
      poLine(601, 9, 3),
      poLine(602, 9, 3),
    );
    const note = buildPoReceiptNote([
      buildItem({
        id: 21,
        product_id: 9,
        product_variant_id: 3,
        purchase_order_item_id: 601,
        dispatched_quantity: 4,
      }),
      buildItem({
        id: 22,
        product_id: 9,
        product_variant_id: 3,
        purchase_order_item_id: 602,
        dispatched_quantity: 6,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleReceived(receivedEvent(note));

    const [, payload] = purchaseOrdersMock.receive.mock.calls[0];
    expect(payload.items).toEqual([
      { id: 601, quantity_received: 4 },
      { id: 602, quantity_received: 6 },
    ]);
    // Dos líneas distintas: el colapso sobre la primera dejaba la segunda línea
    // de la OC pendiente para siempre (y duplicaba la recepción de la primera).
    expect(new Set(payload.items.map((i: any) => i.id)).size).toBe(2);
  });

  it('(h) purchase_order_item_id que NO pertenece a la OC ⇒ lanza DISPATCH_NOTE_PO_LINE_UNRESOLVED y no recibe nada', async () => {
    // El producto SÍ está en la OC: el emparejamiento legado habría resuelto 501
    // y recibido "lo que se parezca", descuadrando cantidades, costeo e IVA.
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const note = buildPoReceiptNote([
      buildItem({
        id: 31,
        product_id: 1,
        purchase_order_item_id: 999,
        dispatched_quantity: 3,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    const err = await listener
      .handleReceived(receivedEvent(note))
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(VendixHttpException);
    expect((err as VendixHttpException).errorCode).toBe(
      'DISPATCH_NOTE_PO_LINE_UNRESOLVED',
    );
    expect((err as VendixHttpException).getResponse()).toMatchObject({
      error_code: 'DISPATCH_NOTE_PO_LINE_UNRESOLVED',
    });
    expect(purchaseOrdersMock.receive).not.toHaveBeenCalled();
  });

  it('(i) ninguna línea resoluble ⇒ lanza DISPATCH_NOTE_NOTHING_RECEIVABLE en vez de resolver en silencio', async () => {
    // Remisión LEGADA (sin purchase_order_item_id) cuyo producto no está en la OC:
    // la rama legada loguea y hace `continue`, así que receiveItems queda vacío.
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const note = buildPoReceiptNote([
      buildItem({
        id: 41,
        product_id: 777,
        purchase_order_item_id: null,
        dispatched_quantity: 2,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    const err = await listener
      .handleReceived(receivedEvent(note))
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(VendixHttpException);
    expect((err as VendixHttpException).errorCode).toBe(
      'DISPATCH_NOTE_NOTHING_RECEIVABLE',
    );
    expect(purchaseOrdersMock.receive).not.toHaveBeenCalled();
  });

  it('(j) colisión de substring en inventory_movements (`remisión #12`) NO salta la recepción de la remisión #1', async () => {
    // Movimiento de OTRA remisión (#12). `contains: 'remisión #1'` lo trae como
    // candidato; la confirmación con frontera debe descartarlo. Nótese que
    // `[DN-RCP#12]` tampoco contiene `[DN-RCP#1]`: el delimitador de cierre es
    // parte del contrato.
    prismaMock.inventory_movements.rows.push({
      id: 77,
      notes: 'Purchase receipt remisión #12 [DN-RCP#12]',
    });
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const note = buildPoReceiptNote([
      buildItem({
        id: 51,
        product_id: 1,
        purchase_order_item_id: 501,
        dispatched_quantity: 3,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleReceived(receivedEvent(note));

    // El prefiltro SÍ devolvió la fila colisionante (si no, la prueba no estaría
    // ejercitando la confirmación con frontera).
    const candidates = await prismaMock.inventory_movements.findMany.mock
      .results[0].value;
    expect(candidates).toHaveLength(1);
    // …y la recepción se ejecutó igual.
    expect(purchaseOrdersMock.receive).toHaveBeenCalledTimes(1);
    expect(purchaseOrdersMock.receive).toHaveBeenCalledWith(PO_ID, {
      items: [{ id: 501, quantity_received: 3 }],
      notes: RECEIPT_NOTES,
    });
  });

  it('(k) colisión de substring en purchase_order_receptions (`remisión #12`) NO salta la delegación de la remisión #1', async () => {
    prismaMock.purchase_order_receptions.rows.push({
      id: 88,
      purchase_order_id: PO_ID,
      notes: 'Recepción por remisión #12 [DN-RCP#12]',
    });
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const note = buildPoReceiptNote([
      buildItem({
        id: 52,
        product_id: 1,
        purchase_order_item_id: 501,
        dispatched_quantity: 5,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleReceived(receivedEvent(note));

    const candidates = await prismaMock.purchase_order_receptions.findMany.mock
      .results[0].value;
    expect(candidates).toHaveLength(1);
    expect(purchaseOrdersMock.receive).toHaveBeenCalledTimes(1);
    expect(purchaseOrdersMock.receive).toHaveBeenCalledWith(PO_ID, {
      items: [{ id: 501, quantity_received: 5 }],
      notes: RECEIPT_NOTES,
    });
  });

  it('(l) re-disparo REAL: una recepción con el token `[DN-RCP#1]` sí salta la delegación (idempotencia intacta)', async () => {
    // Sólo el token delimitado, sin la glosa legada: es exactamente lo que el
    // guard debe reconocer, y es lo que un `contains: 'remisión #1'` no veía.
    prismaMock.purchase_order_receptions.rows.push({
      id: 89,
      purchase_order_id: PO_ID,
      notes: `Recepción [DN-RCP#${NOTE_ID}]`,
    });
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const note = buildPoReceiptNote([
      buildItem({
        id: 53,
        product_id: 1,
        purchase_order_item_id: 501,
        dispatched_quantity: 3,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    await listener.handleReceived(receivedEvent(note));

    // Sin doble recepción de la misma OC.
    expect(purchaseOrdersMock.receive).not.toHaveBeenCalled();
  });

  it('(m) recepción ligada a OC: si PurchaseOrdersService.receive falla, handleReceived RECHAZA (el emisor no compromete el estado)', async () => {
    prismaMock.purchase_order_items.rows.push(poLine(501, 1));
    const boom = new Error('receive falló');
    purchaseOrdersMock.receive.mockRejectedValue(boom);
    const note = buildPoReceiptNote([
      buildItem({
        id: 54,
        product_id: 1,
        purchase_order_item_id: 501,
        dispatched_quantity: 3,
      }),
    ]);
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);

    // `DispatchNoteFlowService.receive` emite con emitAsync ANTES de escribir
    // `status = 'received'`: sólo si esto rechaza la remisión queda `confirmed`
    // y reintentable en vez de responder 200 con la OC sin recibir.
    await expect(listener.handleReceived(receivedEvent(note))).rejects.toBe(
      boom,
    );
    expect(purchaseOrdersMock.receive).toHaveBeenCalledTimes(1);
  });

  it('(n) transfer_in cuyo movimiento de stock falla NO rechaza (el radio del re-throw sigue acotado a la OC)', async () => {
    const note = buildPoReceiptNote(
      [buildItem({ id: 61, product_id: 1, dispatched_quantity: 2 })],
      { subtype: 'transfer_in', purchase_order_id: null, from_location_id: 20 },
    );
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);
    stockLevelManagerMock.updateStock.mockRejectedValue(
      new Error('sin stock en destino'),
    );

    await expect(
      listener.handleReceived(receivedEvent(note)),
    ).resolves.toBeUndefined();
    expect(stockLevelManagerMock.updateStock).toHaveBeenCalledTimes(1);
    expect(purchaseOrdersMock.receive).not.toHaveBeenCalled();
  });

  it('(o) transfer_in cuyo guard de idempotencia explota tampoco rechaza: el re-throw del catch está gateado por la recepción de OC', async () => {
    const note = buildPoReceiptNote(
      [buildItem({ id: 62, product_id: 1, dispatched_quantity: 2 })],
      { subtype: 'transfer_in', purchase_order_id: null, from_location_id: 20 },
    );
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(note);
    // Falla ANTES de ramificar por subtype ⇒ entra al catch EXTERNO, el único
    // sitio donde vive el re-throw.
    prismaMock.inventory_movements.findMany = jest
      .fn()
      .mockRejectedValue(new Error('db caída'));

    await expect(
      listener.handleReceived(receivedEvent(note)),
    ).resolves.toBeUndefined();
    expect(stockLevelManagerMock.updateStock).not.toHaveBeenCalled();
  });

  // (p) El caso (m) prueba que handleReceived RECHAZA, pero eso por sí solo no
  // hace fallar la recepción HTTP: el wrapper de @nestjs/event-emitter envuelve
  // cada @OnEvent en un try/catch cuyo default es
  // `options?.suppressErrors ?? true` (ver
  // node_modules/@nestjs/event-emitter/dist/event-subscribers.loader.js), y con
  // ese default el rechazo se loguea como `ERROR [Event]` y se DESCARTA, así que
  // el emitAsync resuelve igual y la remisión se marca `received` con la OC en
  // `approved`. Eso fue exactamente lo que se observó en runtime antes del
  // arreglo. Esta prueba fija la opción del decorador, porque es la pieza que
  // convierte el rechazo del handler en una recepción realmente fallida y nada
  // en el cuerpo del método la delata.
  it('(p) @OnEvent declara suppressErrors:false — sin eso el rechazo de (m) se descartaría y el emisor resolvería igual', () => {
    const metadata = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      DispatchNoteEventsListener.prototype.handleReceived,
    ) as Array<{ event: string; options?: { suppressErrors?: boolean } }>;

    expect(metadata).toBeDefined();
    const entry = metadata.find((m) => m.event === 'dispatch_note.received');
    expect(entry).toBeDefined();
    // Explícitamente false: `undefined` haría que el wrapper aplique su default
    // `?? true` y volvería a tragarse el error.
    expect(entry!.options?.suppressErrors).toBe(false);
  });
});
