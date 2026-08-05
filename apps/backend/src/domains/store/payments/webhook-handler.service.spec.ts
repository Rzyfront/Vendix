import { Test, TestingModule } from '@nestjs/testing';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WebhookEvent } from './interfaces';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { TableSessionsService } from '../tables/table-sessions.service';

describe('WebhookHandlerService', () => {
  let service: WebhookHandlerService;
  let prisma: StorePrismaService;
  let orderFlow: { confirmPayment: jest.Mock; cancelOrder: jest.Mock };

  const mockStripeEvent: WebhookEvent = {
    processor: 'stripe',
    eventType: 'payment_intent.succeeded',
    data: {
      payment_intent: 'pi_1234567890',
    },
    signature: 'stripe_signature',
    rawBody: '{"type": "payment_intent.succeeded"}',
  };

  const mockPaypalEvent: WebhookEvent = {
    processor: 'paypal',
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    data: {
      resource: {
        id: 'paypal_payment_123',
      },
    },
    rawBody: '{"event_type": "PAYMENT.CAPTURE.COMPLETED"}',
  };

  beforeEach(async () => {
    const mockPrismaService: any = {
      payments: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      orders: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      order_items: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Dedup guard: 1 inserted row = this event has not been seen. Returning 0
      // would make every test below exit early as a duplicate.
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    // updatePaymentStatus wraps lookup + compare-and-swap + order transition in
    // ONE transaction. Handing the same object back as `tx` keeps the tests'
    // spies authoritative inside the transaction too.
    mockPrismaService.$transaction = jest.fn((cb: any) => cb(mockPrismaService));
    // A gateway webhook carries no tenant, so the handler reads through
    // `withoutScope()`. Returning the same object keeps every `jest.spyOn(
    // prisma.payments, ...)` in these tests effective — a separate unscoped
    // double would silently ignore them and the assertions would go vacuous.
    mockPrismaService.withoutScope = jest.fn(() => mockPrismaService);
    // count: 1 = this transaction won the compare-and-swap. With 0 the handler
    // concludes a concurrent webhook already finalized the row and bails out.
    mockPrismaService.payments.updateMany.mockResolvedValue({ count: 1 });

    orderFlow = { confirmPayment: jest.fn(), cancelOrder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        // The handler re-enters a store context before delegating. The stub runs
        // the callback inline: these tests assert webhook parsing, not context
        // propagation (owned by StoreContextRunner's own tests).
        {
          provide: StoreContextRunner,
          useValue: {
            runInStoreContext: jest.fn(
              (_storeId: number, cb: () => unknown) => cb(),
            ),
          },
        },
        {
          provide: OrderFlowService,
          useValue: orderFlow,
        },
        {
          provide: TableSessionsService,
          useValue: { closeSession: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WebhookHandlerService>(WebhookHandlerService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleWebhook', () => {
    it('should handle Stripe payment intent succeeded', async () => {
      const mockPayment = {
        id: 1,
        order_id: 1,
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest.spyOn(prisma.payments, 'update').mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        payments: [],
      });
      jest.spyOn(prisma.orders, 'update').mockResolvedValue({});

      await expect(service.handleWebhook(mockStripeEvent)).resolves.not.toThrow();
    });

    it('should handle PayPal payment capture completed', async () => {
      const mockPayment = {
        id: 1,
        order_id: 1,
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest.spyOn(prisma.payments, 'update').mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        payments: [],
      });
      jest.spyOn(prisma.orders, 'update').mockResolvedValue({});

      await expect(service.handleWebhook(mockPaypalEvent)).resolves.not.toThrow();
    });

    it('should handle unknown processor gracefully', async () => {
      const unknownEvent: WebhookEvent = {
        processor: 'unknown',
        eventType: 'test.event',
        data: {},
        rawBody: '{}',
      };

      await expect(service.handleWebhook(unknownEvent)).resolves.not.toThrow();
    });

    it('should handle payment not found gracefully', async () => {
      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      await expect(service.handleWebhook(mockStripeEvent)).resolves.not.toThrow();
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(prisma.payments, 'findFirst')
        .mockRejectedValue(new Error('Database error'));

      // jest-circus dropped the jasmine `fail` global; a rejects assertion
      // also reports a failure when the call unexpectedly resolves.
      await expect(service.handleWebhook(mockStripeEvent)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('updatePaymentStatus', () => {
    it('should update payment status to succeeded', async () => {
      const mockPayment = {
        id: 1,
        order_id: 1,
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest.spyOn(prisma.payments, 'update').mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        payments: [],
      });
      jest.spyOn(prisma.orders, 'update').mockResolvedValue({});

      await expect(service['updatePaymentStatus']('pi_1234567890', 'succeeded', {})).resolves.not.toThrow();
    });

    it('should set paid_at when status is succeeded', async () => {
      const mockPayment = {
        id: 1,
        order_id: 1,
      };

      const casSpy = (prisma as any).payments.updateMany as jest.Mock;
      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);

      await service['updatePaymentStatus']('pi_1234567890', 'succeeded', {});

      // The write is a compare-and-swap: the WHERE excludes terminal states so
      // a second concurrent webhook cannot overwrite a finalized payment.
      expect(casSpy).toHaveBeenCalledTimes(1);
      const args = casSpy.mock.calls[0][0];
      expect(args.where.id).toBe(1);
      expect(args.where.state.notIn).toContain('succeeded');
      expect(args.data.state).toBe('succeeded');
      expect(args.data.paid_at).toBeInstanceOf(Date);
    });

    it('does NOT touch the order when the compare-and-swap loses', async () => {
      jest
        .spyOn(prisma.payments, 'findFirst')
        .mockResolvedValue({ id: 1, order_id: 1, state: 'pending' });
      (prisma as any).payments.updateMany.mockResolvedValue({ count: 0 });

      const result = await service['updatePaymentStatus'](
        'pi_1234567890',
        'succeeded',
        {},
      );

      // count 0 means another transaction already finalized the row and owns the
      // order transition — driving it twice is what double-confirms an order.
      expect(result.transitioned).toBe(false);
      expect(result.shouldConfirmOrder).toBe(false);
      expect(orderFlow.confirmPayment).not.toHaveBeenCalled();
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status when fully paid', async () => {
      const mockOrder = {
        id: 1,
        store_id: 7,
        state: 'pending_payment',
        grand_total: 100.0,
        payments: [
          {
            state: 'succeeded',
            amount: 100.0,
          },
        ],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      await service['updateOrderStatus'](1);

      // The order transition is NOT a direct orders.update: it delegates to
      // OrderFlowService, which owns the audit trail and the stock side-effects.
      expect(orderFlow.confirmPayment).toHaveBeenCalledWith(1);
    });

    it('should not update order status if already processing', async () => {
      const mockOrder = {
        id: 1,
        state: 'processing',
        grand_total: 100.0,
        payments: [
          {
            state: 'succeeded',
            amount: 100.0,
          },
        ],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      await service['updateOrderStatus'](1);

      expect(orderFlow.confirmPayment).not.toHaveBeenCalled();
    });
  });
});
