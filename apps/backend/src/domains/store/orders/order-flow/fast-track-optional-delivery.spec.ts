import { PaymentType } from './dto';
import { OrderFlowService } from './order-flow.service';

describe('OrderFlowService.fastTrackOrder — confirmación opcional de entrega', () => {
  it('cobra y despacha sin marcar entregada ni finalizar cuando confirm_delivery es false', async () => {
    let state = 'created';
    const payment = {
      store_payment_method_id: 1,
      payment_type: PaymentType.DIRECT,
      amount_received: 100,
    };
    const prisma: any = {
      orders: {
        findFirst: jest.fn(async () => ({ id: 1, state })),
      },
    };
    const service = new OrderFlowService(
      prisma,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => ({
      id: 1,
      store_id: 3,
      order_number: 'O-1',
      state,
      delivery_type: 'direct_delivery',
      shipping_method_id: null,
      grand_total: 100,
      remaining_balance: 100,
      payment_form: '1',
      payments: [],
      order_items: [],
    }));
    const pay = jest.spyOn(service, 'payOrder').mockImplementation(async () => {
      state = 'processing';
      return {} as any;
    });
    jest.spyOn(service, 'shipOrder').mockImplementation(async () => {
      state = 'shipped';
      return {} as any;
    });
    const deliver = jest.spyOn(service, 'deliverOrder');
    const finish = jest.spyOn(service, 'confirmDelivery');
    jest.spyOn(service as any, 'fastTrackIncludes').mockReturnValue({});

    await service.fastTrackOrder(1, {
      payment,
      confirm_delivery: false,
    } as any);

    expect(pay).toHaveBeenCalledWith(1, payment, {
      strictKitchenPending: true,
      deferFinish: true,
    });
    expect(state).toBe('shipped');
    expect(deliver).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});
