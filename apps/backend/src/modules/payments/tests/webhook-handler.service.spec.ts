import { Test, TestingModule } from '@nestjs/testing';
import { WebhookHandlerService } from '../services/webhook-handler.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhookEvent } from '../interfaces';

describe('WebhookHandlerService', () => {
  let service: WebhookHandlerService;
  let prisma: PrismaService;

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
    const mockPrismaService = {
      payments: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      orders: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<WebhookHandlerService>(WebhookHandlerService);
    prisma = module.get<PrismaService>(PrismaService);
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

      await expect(
        service.handleWebhook(mockStripeEvent),
      ).resolves.not.toThrow();
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

      await expect(
        service.handleWebhook(mockPaypalEvent),
      ).resolves.not.toThrow();
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

      await expect(
        service.handleWebhook(mockStripeEvent),
      ).resolves.not.toThrow();
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(prisma.payments, 'findFirst')
        .mockRejectedValue(new Error('Database error'));

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

      await expect(
        service['updatePaymentStatus']('pi_1234567890', 'succeeded', {}),
      ).resolves.not.toThrow();
    });

    it('should set paid_at when status is succeeded', async () => {
      const mockPayment = {
        id: 1,
        order_id: 1,
      };

      const updateSpy = jest
        .spyOn(prisma.payments, 'update')
        .mockResolvedValue({});
      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);

      await service['updatePaymentStatus']('pi_1234567890', 'succeeded', {});

      expect(updateSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status when fully paid', async () => {
      const mockOrder = {
        id: 1,
        state: 'pending_payment',
        grand_total: 100.0,
        payments: [
          {
            state: 'succeeded',
            amount: 100.0,
          },
        ],
      };

      const updateSpy = jest
        .spyOn(prisma.orders, 'update')
        .mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      await service['updateOrderStatus'](1);

      expect(updateSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
      );
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

      const updateSpy = jest
        .spyOn(prisma.orders, 'update')
        .mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      await service['updateOrderStatus'](1);

      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
