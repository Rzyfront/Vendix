import { Test, TestingModule } from '@nestjs/testing';
import { PaymentGatewayService } from './services/payment-gateway.service';
import { PaymentValidatorService } from './services/payment-validator.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from './interfaces';
import { PaymentError, PaymentErrorCodes } from './utils';
import { payments_state_enum } from '@prisma/client';

describe('PaymentGatewayService', () => {
  let service: PaymentGatewayService;
  let prisma: StorePrismaService;
  let validator: PaymentValidatorService;

  const mockPaymentData: PaymentData = {
    orderId: 1,
    customerId: 1,
    amount: 100.0,
    currency: 'USD',
    storePaymentMethodId: 1,
    storeId: 1,
    idempotencyKey: 'idem-gateway-1',
  };

  const mockPaymentResult: PaymentResult = {
    success: true,
    transactionId: 'txn_1234567890_abc123',
    status: payments_state_enum.succeeded,
    message: 'Payment processed successfully',
  };

  const mockOrder = {
    id: 1,
    state: 'created',
    grand_total: 100.0,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      payments: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      orders: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      store_payment_methods: {
        findUnique: jest.fn(),
      },
      refunds: {
        create: jest.fn(),
      },
    };

    const mockValidatorService = {
      validateOrder: jest.fn(),
      validatePaymentMethod: jest.fn(),
      validatePaymentAmount: jest.fn(),
      validateCurrency: jest.fn(),
    };

    // QUI-728 — S3Service se inyecta en PaymentGatewayService para firmar la
    // URL del logo de la cuenta bancaria destino. El mock devuelve `null`
    // porque ningún test del archivo ejercita la rama con imagen.
    const mockS3Service = {
      getPresignedUrl: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentGatewayService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PaymentValidatorService,
          useValue: mockValidatorService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
      ],
    }).compile();

    service = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
    validator = module.get<PaymentValidatorService>(PaymentValidatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        grand_total: 100.0,
      };

      const mockPaymentMethod = {
        id: 1,
        type: 'card',
      };

      const mockCreatedPayment = {
        id: 1,
        transaction_id: 'txn_1234567890_abc123',
      };

      jest.spyOn(validator, 'validateOrder').mockResolvedValue({
        valid: true,
        order: mockOrder,
      });
      jest.spyOn(validator, 'validatePaymentMethod').mockResolvedValue(true);
      jest.spyOn(validator, 'validatePaymentAmount').mockResolvedValue(true);
      jest.spyOn(validator, 'validateCurrency').mockResolvedValue(true);
      jest
        .spyOn(prisma.store_payment_methods, 'findUnique')
        .mockResolvedValue(mockPaymentMethod);
      jest
        .spyOn(prisma.payments, 'create')
        .mockResolvedValue(mockCreatedPayment);
      jest.spyOn(prisma.payments, 'update').mockResolvedValue({});

      // Mock processor
      const mockProcessor = {
        isEnabled: jest.fn().mockReturnValue(true),
        processPayment: jest.fn().mockResolvedValue(mockPaymentResult),
      };
      service.registerProcessor('card', mockProcessor as any);

      const result = await service.processPayment(mockPaymentData);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('txn_1234567890_abc123');
    });

    it('should throw error for invalid order', async () => {
      jest.spyOn(validator, 'validateOrder').mockResolvedValue({
        valid: false,
        errors: ['Order not found'],
      });

      try {
        await service.processPayment(mockPaymentData);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
      }
    });

    it('should throw error for disabled payment method', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        grand_total: 100.0,
      };

      const mockPaymentMethod = {
        id: 1,
        type: 'card',
      };

      jest.spyOn(validator, 'validateOrder').mockResolvedValue({
        valid: true,
        order: mockOrder,
      });
      jest.spyOn(validator, 'validatePaymentMethod').mockResolvedValue(true);
      jest.spyOn(validator, 'validatePaymentAmount').mockResolvedValue(true);
      jest.spyOn(validator, 'validateCurrency').mockResolvedValue(true);
      jest
        .spyOn(prisma.store_payment_methods, 'findUnique')
        .mockResolvedValue(mockPaymentMethod);

      // Mock disabled processor
      const mockProcessor = {
        isEnabled: jest.fn().mockReturnValue(false),
      };
      service.registerProcessor('card', mockProcessor as any);

      try {
        await service.processPayment(mockPaymentData);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
      }
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const mockPayment = {
        id: 1,
        transaction_id: 'txn_1234567890_abc123',
        order_id: 1,
        store_payment_methods: {
          type: 'card',
        },
        state: 'succeeded',
      };

      const mockRefundResult: RefundResult = {
        success: true,
        refundId: 'refund_1234567890',
        amount: 50.0,
        status: 'succeeded',
        message: 'Refund processed successfully',
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);

      // Mock processor
      const mockProcessor = {
        refundPayment: jest.fn().mockResolvedValue(mockRefundResult),
      };
      service.registerProcessor('card', mockProcessor as any);

      jest.spyOn(prisma.refunds, 'create').mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        payments: [],
        refunds: [],
      });

      const result = await service.refundPayment('txn_1234567890_abc123', 50.0);

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('refund_1234567890');
    });

    it('should throw error for non-existent payment', async () => {
      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      try {
        await service.refundPayment('nonexistent_payment');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
      }
    });

    it('should call prisma.refunds.create exactly once on successful refund', async () => {
      const mockPayment = {
        id: 1,
        transaction_id: 'txn_refund_count',
        order_id: 1,
        store_payment_methods: {
          type: 'card',
        },
        state: 'succeeded',
      };

      const mockRefundResult: RefundResult = {
        success: true,
        refundId: 'refund_count_1',
        amount: 50.0,
        status: 'succeeded',
        message: 'Refund processed successfully',
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);

      const mockProcessor = {
        refundPayment: jest.fn().mockResolvedValue(mockRefundResult),
      };
      service.registerProcessor('card', mockProcessor as any);

      const createSpy = jest
        .spyOn(prisma.refunds, 'create')
        .mockResolvedValue({});
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        payments: [],
        refunds: [],
      });

      const result = await service.refundPayment(
        'txn_refund_count',
        50.0,
        'Customer request',
      );

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('refund_count_1');
      // Regression guard for the A.1 refactor: the extracted
      // reversePaymentWithProcessor() must not introduce a duplicate
      // createRefundRecord call.
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPaymentStatus', () => {
    it('should get payment status', async () => {
      const mockPayment = {
        id: 1,
        transaction_id: 'txn_1234567890_abc123',
        store_payment_methods: {
          type: 'card',
        },
      };

      const mockStatus: PaymentStatus = {
        status: payments_state_enum.succeeded,
        transactionId: 'txn_1234567890_abc123',
        paidAt: new Date(),
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);

      // Mock processor
      const mockProcessor = {
        getPaymentStatus: jest.fn().mockResolvedValue(mockStatus),
      };
      service.registerProcessor('card', mockProcessor as any);

      const result = await service.getPaymentStatus('txn_1234567890_abc123');

      expect(result.status).toBe(payments_state_enum.succeeded);
      expect(result.transactionId).toBe('txn_1234567890_abc123');
    });

    it('should throw error for non-existent payment', async () => {
      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      try {
        await service.getPaymentStatus('nonexistent_payment');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
      }
    });
  });

  describe('registerProcessor', () => {
    it('should register payment processor', () => {
      const mockProcessor = {
        processPayment: jest.fn(),
        refundPayment: jest.fn(),
        validatePayment: jest.fn(),
        getPaymentStatus: jest.fn(),
        validateWebhook: jest.fn(),
      };

      expect(() =>
        service.registerProcessor('test', mockProcessor as any),
      ).not.toThrow();
    });
  });
});
