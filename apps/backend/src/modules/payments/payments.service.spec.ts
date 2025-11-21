import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentData, PaymentResult, PaymentStatus } from './interfaces';
import { PaymentGatewayService, PaymentValidatorService } from './services';
import { StorePaymentMethodsService } from './services/store-payment-methods.service';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { PaymentError, PaymentErrorCodes } from './utils';
import { PrismaService } from '../../prisma/prisma.service';
import { payments_state_enum } from '@prisma/client';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentGateway: PaymentGatewayService;
  let prisma: PrismaService;

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
  };

  const mockPaymentResult = {
    success: true,
    transactionId: 'txn_1234567890_abc123',
    status: payments_state_enum.succeeded,
    message: 'Payment processed successfully',
  };

  const mockOrder = {
    id: 1,
    order_number: 'ORD202511140001',
    state: 'created',
    grand_total: 100.0,
    store_id: 1,
    stores: {
      id: 1,
      name: 'Test Store',
    },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      payments: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      store_users: {
        findMany: jest.fn(),
      },
      stores: {
        findUnique: jest.fn(),
      },
    };

    const mockPaymentGateway = {
      processPayment: jest.fn(),
      processPaymentWithNewOrder: jest.fn(),
      refundPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PaymentGatewayService,
          useValue: mockPaymentGateway,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PaymentValidatorService,
          useValue: {},
        },
        {
          provide: WebhookHandlerService,
          useValue: {},
        },
        {
          provide: StockLevelManager,
          useValue: {
            updateStock: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentGateway = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'processPayment')
        .mockResolvedValue(mockPaymentResult);

      const result = await service.processPayment(createPaymentDto, mockUser);

      expect(paymentGateway.processPayment).toHaveBeenCalledWith(
        createPaymentDto,
      );
      expect(result).toEqual({
        success: true,
        data: mockPaymentResult,
        message: 'Payment processed successfully',
      });
    });

    it('should handle payment errors', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      const paymentError = new PaymentError(
        PaymentErrorCodes.INVALID_ORDER,
        'Order not found',
      );

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'processPayment')
        .mockRejectedValue(paymentError);

      try {
        await service.processPayment(createPaymentDto, mockUser);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
      }
    });

    it('should validate user access to store', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 2, // Different store
      };

      const mockStoreUsers = [
        { store_id: 1 }, // User only has access to store 1
      ];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);

      try {
        await service.processPayment(createPaymentDto, mockUser);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Access denied to this store');
      }
    });
  });

  describe('processPaymentWithOrder', () => {
    it('should create order and process payment', async () => {
      const createOrderPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
        customerEmail: 'customer@example.com',
        customerName: 'John Doe',
        items: [
          {
            productId: 1,
            productName: 'Test Product',
            quantity: 1,
            unitPrice: 100.0,
            totalPrice: 100.0,
          },
        ],
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'processPaymentWithNewOrder')
        .mockResolvedValue(mockPaymentResult);

      const result = await service.processPaymentWithOrder(
        createOrderPaymentDto,
        mockUser,
      );

      expect(paymentGateway.processPaymentWithNewOrder).toHaveBeenCalledWith(
        createOrderPaymentDto,
      );
      expect(result).toEqual({
        success: true,
        data: mockPaymentResult,
        message: 'Order created and payment processed successfully',
      });
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const refundDto = {
        paymentId: 'txn_1234567890_abc123',
        amount: 50.0,
        reason: 'Customer request',
      };

      const mockPayment = {
        transaction_id: 'txn_1234567890_abc123',
        orders: mockOrder,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      const mockRefundResult = {
        success: true,
        refundId: 'refund_1234567890',
        amount: 50.0,
        status: 'succeeded' as const,
        message: 'Payment refunded successfully',
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'refundPayment')
        .mockResolvedValue(mockRefundResult);

      const result = await service.refundPayment(
        'txn_1234567890_abc123',
        refundDto,
        mockUser,
      );

      expect(paymentGateway.refundPayment).toHaveBeenCalledWith(
        'txn_1234567890_abc123',
        50.0,
        'Customer request',
      );
      expect(result).toEqual({
        success: true,
        data: mockRefundResult,
        message: 'Payment refunded successfully',
      });
    });

    it('should throw error if payment not found', async () => {
      const refundDto = {
        paymentId: 'nonexistent_payment',
        amount: 50.0,
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      try {
        await service.refundPayment('nonexistent_payment', refundDto, mockUser);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Payment not found');
      }
    });
  });

  describe('findAll', () => {
    it('should return paginated payments', async () => {
      const query = {
        page: 1,
        limit: 10,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      const mockPayments = [
        {
          id: 1,
          transaction_id: 'txn_1234567890_abc123',
          amount: 100.0,
          currency: 'USD',
          state: payments_state_enum.succeeded,
          created_at: new Date(),
        },
      ];

      const mockCount = 1;

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest.spyOn(prisma.payments, 'findMany').mockResolvedValue(mockPayments);
      jest.spyOn(prisma.payments, 'count').mockResolvedValue(mockCount);

      const result = await service.findAll(query, mockUser);

      expect(result.data).toEqual(mockPayments);
      expect(result.pagination).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('findOne', () => {
    it('should return payment by transaction ID', async () => {
      const paymentId = 'txn_1234567890_abc123';

      const mockPayment = {
        id: 1,
        transaction_id: paymentId,
        amount: 100.0,
        currency: 'USD',
        state: payments_state_enum.succeeded,
        orders: mockOrder,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);

      const result = await service.findOne(paymentId, mockUser);

      expect(result.data).toEqual(mockPayment);
    });

    it('should throw error if payment not found', async () => {
      const paymentId = 'nonexistent_payment';

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      try {
        await service.findOne(paymentId, mockUser);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Payment not found');
      }
    });
  });
});
