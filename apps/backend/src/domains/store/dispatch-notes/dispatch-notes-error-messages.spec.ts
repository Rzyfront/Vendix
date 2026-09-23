import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { DispatchNotesService } from './dispatch-notes.service';

describe('DispatchNotesService — errores accionables de orden', () => {
  const orderId = 4321;
  let service: DispatchNotesService;
  let prismaMock: {
    orders: { findFirst: jest.Mock; updateMany: jest.Mock };
    dispatch_notes: { count: jest.Mock };
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 12,
      user_id: 5,
    } as any);
    prismaMock = {
      orders: { findFirst: jest.fn(), updateMany: jest.fn() },
      dispatch_notes: { count: jest.fn() },
    };
    service = new DispatchNotesService(
      prismaMock as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  async function expectRejection(
    action: () => Promise<unknown>,
    errorCode: string,
    fragments: string[],
  ) {
    try {
      await action();
      throw new Error('Se esperaba un rechazo de despacho');
    } catch (error) {
      expect(error).toBeInstanceOf(VendixHttpException);
      const exception = error as VendixHttpException;
      expect(exception.errorCode).toBe(errorCode);
      const response = exception.getResponse() as { message: string };
      for (const fragment of fragments) {
        expect(response.message).toContain(fragment);
      }
    }
  }

  it('createFromOrder conserva el gate de estado e indica el estado real y el siguiente paso', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: orderId,
      state: 'finished',
      delivery_type: 'home_delivery',
    });

    await expectRejection(
      () => service.createFromOrder(orderId, {} as any),
      'DSP_ORDER_STATE_001',
      ['finished', 'processing', 'pending_payment', 'Revise el estado'],
    );
    expect(prismaMock.dispatch_notes.count).not.toHaveBeenCalled();
  });

  it('createFromOrder conserva el gate de entrega directa e indica el tipo real y la corrección', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: orderId,
      state: 'processing',
      delivery_type: 'direct_delivery',
    });

    await expectRejection(
      () => service.createFromOrder(orderId, {} as any),
      'DSP_ORDER_DELIVERY_001',
      ['direct_delivery', 'entrega en el acto', 'corrija el tipo de entrega'],
    );
  });

  it('sendToDispatchPool conserva el gate de estado e indica el estado real y el siguiente paso', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: orderId,
      state: 'finished',
      delivery_type: 'home_delivery',
      dispatch_pool_at: null,
    });

    await expectRejection(
      () => service.sendToDispatchPool(orderId),
      'DSP_ORDER_STATE_001',
      ['finished', 'processing', 'pending_payment', 'Revise el estado'],
    );
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('sendToDispatchPool conserva el gate de entrega directa e indica el tipo real y la corrección', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: orderId,
      state: 'processing',
      delivery_type: 'direct_delivery',
      dispatch_pool_at: null,
    });

    await expectRejection(
      () => service.sendToDispatchPool(orderId),
      'DSP_ORDER_DELIVERY_001',
      ['direct_delivery', 'entrega en el acto', 'corrija el tipo de entrega'],
    );
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });
});
