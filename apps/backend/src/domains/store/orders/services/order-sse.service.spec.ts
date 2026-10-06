import { NotificationsSseService } from '../../notifications/notifications-sse.service';
import { OrderSseService } from './order-sse.service';

describe('OrderSseService', () => {
  let service: OrderSseService;
  let push: jest.Mock;

  beforeEach(() => {
    push = jest.fn();
    service = new OrderSseService({ push } as unknown as NotificationsSseService);
  });

  it('broadcasts order.created with its store and order identifiers', () => {
    service.pushOrderEvent(27, 914, 'order.created', {
      order_number: 'V-914',
      grand_total: 125_000,
      currency: 'COP',
    });

    expect(push).toHaveBeenCalledWith(
      27,
      expect.objectContaining({
        type: 'order.created',
        data: {
          order_id: 914,
          kind: 'order.created',
          order_number: 'V-914',
          grand_total: 125_000,
          currency: 'COP',
        },
      }),
    );
  });

  it('does not publish an event without valid tenant and order ids', () => {
    service.pushOrderEvent(0, 914, 'order.created');
    service.pushOrderEvent(27, 0, 'order.created');

    expect(push).not.toHaveBeenCalled();
  });
});
