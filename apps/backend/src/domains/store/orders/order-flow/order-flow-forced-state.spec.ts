import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { BadRequestException } from '@nestjs/common';

/**
 * QUI-557 — Carril FORZADO de la máquina de estados
 * ({@link OrderFlowService.forceOrderState}).
 *
 * Los botones "manuales" de la página de detalle pegan a
 * `PATCH /store/orders/:id {"state":...}`, y ese endpoint escribía
 * `orders.state` en crudo: sin efectos, sin eventos y sin liberar reservas.
 * `cancelled` dejaba `stock_reservations` activas restando de
 * `quantity_available` (el falso "sin stock" del ticket), y `shipped` nunca
 * emitía `order.shipped`, así que el OrderAutoFulfillmentListener jamás
 * consumía la reserva original de una orden de alcance ORGANIZATION.
 *
 * La invariante que fijan estos tests, y la razón por la que el fix no es un
 * comentario sino código compartido: **forzar saltea precondiciones, NUNCA
 * efectos**. `forceOrderState` despacha a los MISMOS métodos canónicos con
 * `force = true`, así que la cadena de efectos no es una copia que haya que
 * mantener sincronizada.
 *
 * Contraparte igual de importante: el carril estricto (`/flow/*`) sigue
 * rechazando lo que rechazaba. Sin esos dos tests, un `force` mal cableado
 * (p. ej. con default `true`) pasaría desapercibido.
 */
describe('OrderFlowService — carril forzado (QUI-557)', () => {
  let service: OrderFlowService;
  let prismaMock: any;
  let eventEmitterMock: { emit: jest.Mock };
  let stockLevelManagerMock: { releaseReservationsByReference: jest.Mock };

  const ORDER_ID = 607;
  const STORE_ID = 10;

  /** Orden mínima con la forma que consumen los tres métodos canónicos. */
  const buildOrder = (state: string, extra: Record<string, any> = {}) => ({
    id: ORDER_ID,
    order_number: 'ORD607',
    state,
    store_id: STORE_ID,
    delivery_type: 'home_delivery',
    shipping_method_id: null,
    internal_notes: null,
    payments: [],
    stores: { id: STORE_ID, organization_id: 1 },
    ...extra,
  });

  /** Fija el estado que verán `forceOrderState` y el canónico al que despacha. */
  const withOrder = (state: string, extra: Record<string, any> = {}) => {
    const order = buildOrder(state, extra);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    return order;
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(42);

    prismaMock = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: STORE_ID,
          stores: { organization_id: 1 },
        }),
        findUnique: jest.fn().mockResolvedValue({ internal_notes: null }),
        update: jest.fn().mockResolvedValue({ id: ORDER_ID, store_id: STORE_ID }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payments: { update: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    eventEmitterMock = { emit: jest.fn() };
    stockLevelManagerMock = {
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };

    // 9 args del constructor, en orden: prisma, eventEmitter, settings,
    // sessions, movements, stockLevelManager, orderEta, orderStockCommit, auditService.
    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitterMock as any,
      {} as any,
      {} as any,
      {} as any,
      stockLevelManagerMock as any,
      {} as any,
      {} as any,
      { log: jest.fn(), logCustom: jest.fn() } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('la transición ilegal se escribe igual, pero por el único escritor', () => {
    it('shipped -> created (arista inexistente) llega a updateOrderState', async () => {
      // VALID_TRANSITIONS.shipped === ['delivered'], así que 'created' es
      // imposible por el carril estricto.
      withOrder('shipped');
      const updateState = jest
        .spyOn(service as any, 'updateOrderState')
        .mockResolvedValue({ id: ORDER_ID, state: 'created' });

      await service.forceOrderState(ORDER_ID, 'created', { reason: 'manual' });

      expect(updateState).toHaveBeenCalledWith(ORDER_ID, 'created');
    });

    it('marca forced=true y atribuye la forzada al usuario del contexto', async () => {
      withOrder('shipped');
      jest
        .spyOn(service as any, 'updateOrderState')
        .mockResolvedValue({ id: ORDER_ID });

      await service.forceOrderState(ORDER_ID, 'created', {
        reason: 'desatascar orden',
      });

      // La traza vive en internal_notes._flow_metadata: `orders` no tiene
      // columnas para esto y el ticket no justificaba una migración.
      const written = JSON.parse(
        prismaMock.orders.update.mock.calls.at(-1)[0].data.internal_notes,
      );
      expect(written._flow_metadata.forced_transition).toEqual(
        expect.objectContaining({
          from: 'shipped',
          to: 'created',
          forced: true,
          reason: 'desatascar orden',
          user_id: 42,
        }),
      );
    });

    it('marca forced=false cuando la transición sí era legal', async () => {
      // El PATCH genérico también recibe transiciones válidas; distinguirlas
      // evita que la auditoría grite en casos normales.
      withOrder('processing');
      jest
        .spyOn(service as any, 'deliverOrder')
        .mockResolvedValue({ id: ORDER_ID });

      await service.forceOrderState(ORDER_ID, 'delivered', { reason: 'manual' });

      const written = JSON.parse(
        prismaMock.orders.update.mock.calls.at(-1)[0].data.internal_notes,
      );
      expect(written._flow_metadata.forced_transition.forced).toBe(false);
    });
  });

  describe('los efectos SÍ corren — es el daño que causaba el camino crudo', () => {
    it('shipped forzado emite order.shipped, que es lo que consume la reserva', async () => {
      // Desde 'created' y sin shipping_method_id: el carril estricto revienta
      // con ORD_SHIP_REQUIRED_001 antes de llegar al evento.
      withOrder('created', { shipping_method_id: null });
      jest
        .spyOn(service as any, 'updateOrderState')
        .mockResolvedValue({ id: ORDER_ID, state: 'shipped' });

      await service.forceOrderState(ORDER_ID, 'shipped', { reason: 'manual' });

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        'order.shipped',
        expect.objectContaining({
          order_id: ORDER_ID,
          store_id: STORE_ID,
          organization_id: 1,
        }),
      );
    });

    it('cancelled forzado desde delivered libera las reservas', async () => {
      // 'delivered' ∉ CANCELABLE_STATES: el carril estricto lo rechaza.
      withOrder('delivered');

      await service.forceOrderState(ORDER_ID, 'cancelled', {
        reason: 'anulada tras entrega',
      });

      expect(
        stockLevelManagerMock.releaseReservationsByReference,
      ).toHaveBeenCalledWith('order', ORDER_ID, 'cancelled');
    });

    it('cancelled forzado conserva el claim atómico anclado al estado leído', async () => {
      // Única excepción documentada al "solo updateOrderState escribe state":
      // cancelOrder usa un UPDATE condicional para serializar cancelaciones
      // concurrentes. Forzando NO se vuelve un UPDATE ciego — el WHERE sigue
      // filtrando por estado, ahora por el que se leyó.
      withOrder('delivered');

      await service.forceOrderState(ORDER_ID, 'cancelled', { reason: 'manual' });

      expect(prismaMock.orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID, state: { in: ['delivered'] } },
          data: expect.objectContaining({ state: 'cancelled' }),
        }),
      );
    });

    it('finished forzado pasa por updateOrderState, que commitea inventario', async () => {
      // updateOrderState es quien enruta el commit de stock por
      // OrderStockCommitService y aplica la guarda de cocina; saltárselo
      // dejaría la venta sin descontar.
      withOrder('created');
      const updateState = jest
        .spyOn(service as any, 'updateOrderState')
        .mockResolvedValue({ id: ORDER_ID, state: 'finished' });

      await service.forceOrderState(ORDER_ID, 'finished', { reason: 'manual' });

      expect(updateState).toHaveBeenCalledWith(
        ORDER_ID,
        'finished',
        expect.objectContaining({ finished_at: expect.any(Date) }),
      );
    });
  });

  describe('idempotencia', () => {
    it('forzar al estado actual no escribe ni audita nada', async () => {
      // El botón manual se puede pulsar dos veces; la segunda no debe
      // re-ejecutar efectos ni registrar una forzada que no ocurrió.
      withOrder('shipped');
      const updateState = jest.spyOn(service as any, 'updateOrderState');

      await service.forceOrderState(ORDER_ID, 'shipped', { reason: 'manual' });

      expect(updateState).not.toHaveBeenCalled();
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
      expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('el carril estricto sigue estricto', () => {
    it('shipOrder sin force rechaza un estado que no es processing', async () => {
      withOrder('created');

      await expect(service.shipOrder(ORDER_ID, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('shipOrder sin force sigue exigiendo método de envío', async () => {
      withOrder('processing', { shipping_method_id: null });

      // ORD_SHIP_REQUIRED_001 — el portón que motivó el modo manual.
      await expect(service.shipOrder(ORDER_ID, {})).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });

    it('deliverOrder sin force rechaza un estado que no es shipped', async () => {
      withOrder('processing');

      await expect(service.deliverOrder(ORDER_ID, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cancelOrder sin force sigue rechazando desde delivered', async () => {
      withOrder('delivered');

      await expect(
        service.cancelOrder(ORDER_ID, { reason: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('appendFlowMetadata preserva lo que ya había', () => {
    it('fusiona con la metadata previa sin borrarla', async () => {
      prismaMock.orders.findUnique.mockResolvedValue({
        internal_notes: JSON.stringify({
          _flow_metadata: { cancelled_at: '2026-07-01', previous_state: 'processing' },
          notes: 'nota del operador',
        }),
      });

      await (service as any).appendFlowMetadata(ORDER_ID, { forced_transition: { to: 'x' } });

      const written = JSON.parse(
        prismaMock.orders.update.mock.calls[0][0].data.internal_notes,
      );
      expect(written._flow_metadata.previous_state).toBe('processing');
      expect(written._flow_metadata.forced_transition).toEqual({ to: 'x' });
      expect(written.notes).toBe('nota del operador');
    });

    it('no pierde una nota en texto plano escrita a mano', async () => {
      prismaMock.orders.findUnique.mockResolvedValue({
        internal_notes: 'el cliente pidió factura aparte',
      });

      await (service as any).appendFlowMetadata(ORDER_ID, { forced_transition: {} });

      const written = JSON.parse(
        prismaMock.orders.update.mock.calls[0][0].data.internal_notes,
      );
      expect(written.notes).toBe('el cliente pidió factura aparte');
    });

    it('no toca state — ese sigue siendo territorio de updateOrderState', async () => {
      await (service as any).appendFlowMetadata(ORDER_ID, { forced_transition: {} });

      expect(prismaMock.orders.update.mock.calls[0][0].data.state).toBeUndefined();
    });
  });
});
