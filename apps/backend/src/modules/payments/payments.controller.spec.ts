
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
  CreatePosPaymentDto,
  PosPaymentResponseDto,
} from './dto';
import { payments_state_enum } from '@prisma/client';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
  };

  const mockPaymentResult = {
    success: true,
    data: {
      success: true,
      transactionId: 'txn_1234567890_abc123',
      status: payments_state_enum.succeeded,
      message: 'Payment processed successfully',
    },
    message: 'Payment processed successfully',
  };

  beforeEach(async () => {
    const mockPaymentsService = {
      processPayment: jest.fn(),
      processPaymentWithOrder: jest.fn(),
      refundPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('processPayment', () => {
    it('should process payment for existing order', async () => {
      const createPaymentDto: CreatePaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      jest
        .spyOn(service, 'processPayment')
        .mockResolvedValue(mockPaymentResult);

      const result = await controller.processPayment(
        createPaymentDto,
        { user: mockUser },
      );

      expect(service.processPayment).toHaveBeenCalledWith(
        createPaymentDto,
        mockUser,
      );
      expect(result).toEqual(mockPaymentResult);
    });

    it('should handle payment processing errors', async () => {
      const createPaymentDto: CreatePaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const errorResponse = {
        success: false,
        code: 'INVALID_ORDER',
        message: 'Order not found',
      };

      jest.spyOn(service, 'processPayment').mockRejectedValue(errorResponse);

      try {
        await controller.processPayment(createPaymentDto, { user: mockUser });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('processPaymentWithOrder', () => {
    it('should create order and process payment', async () => {
      const createOrderPaymentDto: CreateOrderPaymentDto = {
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

      jest
        .spyOn(service, 'processPaymentWithOrder')
        .mockResolvedValue(mockPaymentResult);

      const result = await controller.processPaymentWithOrder(
        createOrderPaymentDto,
        { user: mockUser },
      );

      expect(service.processPaymentWithOrder).toHaveBeenCalledWith(
        createOrderPaymentDto,
        mockUser,
      );
      expect(result).toEqual(mockPaymentResult);
    });
  });

  describe('refundPayment', () => {
    it('should refund payment', async () => {
      const refundDto: RefundPaymentDto = {
        paymentId: 'txn_1234567890_abc123',
        amount: 50.0,
        reason: 'Customer request',
      };

      const mockRefundResult = {
        success: true,
        data: {
          success: true,
          refundId: 'refund_1234567890',
          amount: 50.0,
          status: 'succeeded' as const,
          message: 'Payment refunded successfully',
        },
        message: 'Payment refunded successfully',
      };

      jest.spyOn(service, 'refundPayment').mockResolvedValue(mockRefundResult);

      const result = await controller.refundPayment(
        'txn_1234567890_abc123',
        refundDto,
        { user: mockUser },
      );

      expect(service.refundPayment).toHaveBeenCalledWith(
        'txn_1234567890_abc123',
        refundDto,
        mockUser,
      );
      expect(result).toEqual(mockRefundResult);
    });
  });

  describe('getPaymentStatus', () => {
    it('should get payment status', async () => {
      const mockStatusResult = {
        success: true,
        data: {
          status: payments_state_enum.succeeded,
          transactionId: 'txn_1234567890_abc123',
          paidAt: new Date(),
        },
      };

      jest
        .spyOn(service, 'getPaymentStatus')
        .mockResolvedValue(mockStatusResult);

      const result = await controller.getPaymentStatus(
        'txn_1234567890_abc123',
        { user: mockUser },
      );

      expect(service.getPaymentStatus).toHaveBeenCalledWith(
        'txn_1234567890_abc123',
        mockUser,
      );
      expect(result).toEqual(mockStatusResult);
    });
  });

  describe('findAll', () => {
    it('should get paginated payments', async () => {
      const mockPaymentsList = {
        data: [
          {
            id: 1,
            transaction_id: 'txn_1234567890_abc123',
            amount: 100.0,
            currency: 'USD',
            state: payments_state_enum.succeeded,
            created_at: new Date(),
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      jest.spyOn(service, 'findAll').mockResolvedValue(mockPaymentsList);

      const result = await controller.findAll({ page: 1, limit: 10 }, { user: mockUser });

      expect(service.findAll).toHaveBeenCalledWith(
        { page: 1, limit: 10 },
        mockUser,
      );
      expect(result).toEqual(mockPaymentsList);
    });
  });

  describe('findOne', () => {
    it('should get payment by ID', async () => {
      const mockPayment = {
        data: {
          id: 1,
          transaction_id: 'txn_1234567890_abc123',
          amount: 100.0,
          currency: 'USD',
          state: payments_state_enum.succeeded,
          created_at: new Date(),
        },
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockPayment);

      const result = await controller.findOne(
        'txn_1234567890_abc123',
        { user: mockUser },
      );

      expect(service.findOne).toHaveBeenCalledWith(
        'txn_1234567890_abc123',
        mockUser,
      );
      expect(result).toEqual(mockPayment);
    });
  });
});
