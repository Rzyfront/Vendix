import { OrderHistoryService } from './order-history.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('OrderHistoryService', () => {
  let service: OrderHistoryService;
  let mockTx: {
    order_events: { create: jest.Mock };
  };
  let mockStorePrisma: {
    order_events: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(() => {
    mockTx = {
      order_events: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    mockStorePrisma = {
      order_events: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new OrderHistoryService(mockStorePrisma as unknown as StorePrismaService);

    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined);
    jest.spyOn(RequestContextService, 'getRequestId').mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('record', () => {
    it('escribe el actor y el request_id desde RequestContextService cuando hay contexto', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(42);
      jest.spyOn(RequestContextService, 'getRequestId').mockReturnValue('req-123');

      await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'payment_registered',
        amount: 100,
      });

      expect(mockTx.order_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          order_id: 10,
          store_id: 5,
          event_type: 'payment_registered',
          actor_user_id: 42,
          actor_source: 'http',
          request_id: 'req-123',
        }),
      });
    });

    it('sin contexto de request escribe actor_user_id null con el source dado por el llamador', async () => {
      await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'payment_cancelled',
        source: 'webhook',
      });

      expect(mockTx.order_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor_user_id: null,
          actor_source: 'webhook',
        }),
      });
    });

    it('sin contexto y sin source explícito cae a system', async () => {
      await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'invoice_issued',
      });

      expect(mockTx.order_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor_user_id: null,
          actor_source: 'system',
        }),
      });
    });

    it('state_changed con from_state === to_state no escribe y retorna null', async () => {
      const result = await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'state_changed',
        fromState: 'processing',
        toState: 'processing',
      });

      expect(result).toBeNull();
      expect(mockTx.order_events.create).not.toHaveBeenCalled();
    });

    it('state_changed con from_state distinto de to_state sí escribe', async () => {
      await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'state_changed',
        fromState: 'processing',
        toState: 'shipped',
      });

      expect(mockTx.order_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          from_state: 'processing',
          to_state: 'shipped',
        }),
      });
    });

    it('store_id siempre viaja explícito en el data, sin depender del scoping del tx', async () => {
      // Contexto con un usuario de OTRA tienda: si `record` confiara en el
      // scoping automático del tx (que en el patrón real de Vendix ni
      // siquiera existe: $transaction entrega el baseClient sin scope), esta
      // prueba fallaría porque el store_id escrito no sería el explícito.
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(1);

      await service.record(mockTx as any, {
        orderId: 10,
        storeId: 5,
        type: 'shipping_assigned',
      });

      expect(mockTx.order_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ store_id: 5 }),
      });
    });

    it('acepta el StorePrismaService scopeado como tx además del cliente de transacción', async () => {
      await service.record(mockStorePrisma as any, {
        orderId: 10,
        storeId: 5,
        type: 'customer_changed',
      });

      expect(mockStorePrisma.order_events.create).toHaveBeenCalled();
    });
  });

  describe('listForOrder', () => {
    it('consulta order_events por order_id, orden cronológico ascendente, con el actor', async () => {
      await service.listForOrder(10);

      expect(mockStorePrisma.order_events.findMany).toHaveBeenCalledWith({
        where: { order_id: 10 },
        orderBy: { created_at: 'asc' },
        include: {
          users: { select: { id: true, first_name: true, last_name: true } },
        },
      });
    });
  });
});
