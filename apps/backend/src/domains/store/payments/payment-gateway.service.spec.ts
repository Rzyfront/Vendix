import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentError, PaymentErrorCodes } from './utils';
import { VendixHttpException } from 'src/common/errors';
import { Prisma, payments_state_enum } from '@prisma/client';
import { createPrismaMock, PrismaMock } from '../../../testing/prisma-mock';
import { buildOrder, buildPayment } from '../../../testing/money-fixtures';
// Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
import { OrderHistoryService } from '../orders/order-history/order-history.service';

describe('PaymentGatewayService', () => {
  let service: PaymentGatewayService;
  let prisma: StorePrismaService;
  let validator: PaymentValidatorService;
  let orderHistory: { record: jest.Mock };

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
        {
          provide: OrderHistoryService,
          useValue: { record: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
    validator = module.get<PaymentValidatorService>(PaymentValidatorService);
    orderHistory = module.get<any>(OrderHistoryService);
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

    it('registra state_changed con source webhook cuando la confirmación de la pasarela pone la orden al día', async () => {
      const mockOrder = {
        id: 1,
        store_id: 1,
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
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue({
        id: 1,
        store_id: 1,
        state: 'created',
        grand_total: 100.0,
        payments: [{ state: 'succeeded', amount: 100.0 }],
        stores: { organization_id: 9 },
      } as any);
      jest.spyOn(prisma.orders, 'update').mockResolvedValue({} as any);

      const mockProcessor = {
        isEnabled: jest.fn().mockReturnValue(true),
        processPayment: jest.fn().mockResolvedValue(mockPaymentResult),
      };
      service.registerProcessor('card', mockProcessor as any);

      await service.processPayment(mockPaymentData);

      expect(orderHistory.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          orderId: 1,
          storeId: 1,
          organizationId: 9,
          type: 'state_changed',
          fromState: 'created',
          toState: 'processing',
        }),
      );
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

    it('propagates the typed already-paid order error before creating a payment', async () => {
      jest.spyOn(validator, 'validateOrder').mockResolvedValue({
        valid: false,
        errors: ['Order is already fully paid'],
        errorCode: 'ORD_PAY_ALREADY_PAID_001',
      });

      const error = await service.processPayment(mockPaymentData).catch((failure) => failure);
      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.errorCode).toBe('ORD_PAY_ALREADY_PAID_001');
      expect(error.getStatus()).toBe(409);
      expect(prisma.payments.create).not.toHaveBeenCalled();
    });

    it('preserves the typed order error through processPaymentWithNewOrder', async () => {
      jest.spyOn(service as any, 'createOrderFromPaymentData').mockResolvedValue({ id: 1 });
      jest.spyOn(validator, 'validateOrder').mockResolvedValue({
        valid: false,
        errorCode: 'ORD_PAY_ALREADY_PAID_001',
        errors: ['Order is already fully paid'],
      });

      const error = await service.processPaymentWithNewOrder({
        ...mockPaymentData,
        customerEmail: 'customer@example.com',
        customerName: 'Customer',
        items: [],
      }).catch((failure) => failure);
      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.errorCode).toBe('ORD_PAY_ALREADY_PAID_001');
      expect(prisma.payments.create).not.toHaveBeenCalled();
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

  /**
   * El cliente NO decide qué validaciones se saltan.
   *
   * `metadata` viaja desde el body de `POST /store/payments` (permiso
   * `store:pos:access`, o sea cualquier cajero). Mientras el gateway leyera
   * `metadata.is_pos_payment` para saltar `validateOrder` + `validatePaymentAmount`,
   * ese cajero podía cobrar dos veces la misma orden: la compuerta anti-sobrepago
   * (`payment-validator.service.ts` → `amount <= grand_total − pagos
   * succeeded|captured|pending`) quedaba desactivada por una bandera que él mismo
   * ponía.
   *
   * Estos casos usan el `PaymentValidatorService` REAL contra un mock de Prisma:
   * mockear el validador convertiría la prueba en una tautología (comprobaría que
   * el gateway llama a un doble, no que el dinero queda protegido).
   */
  describe('bypass de validación vía metadata (defecto de dinero)', () => {
    const STORE_ID = 100;
    const ORDER_ID = 9001;
    const PAYMENT_METHOD_ID = 1;

    let gateway: PaymentGatewayService;
    let prismaMock: PrismaMock;
    let processor: {
      isEnabled: jest.Mock;
      processPayment: jest.Mock;
    };

    const paymentMethodRow = {
      id: PAYMENT_METHOD_ID,
      store_id: STORE_ID,
      state: 'enabled',
      type: 'cash',
      system_payment_method: {
        id: PAYMENT_METHOD_ID,
        type: 'cash',
        is_active: true,
      },
    };

    /** Cobro tal cual lo arma `chargeAdoptedOrder` (pos-payment.service.ts). */
    const posCharge = (overrides: Partial<PaymentData> = {}): PaymentData => ({
      orderId: ORDER_ID,
      amount: 59.5,
      currency: 'COP',
      storePaymentMethodId: PAYMENT_METHOD_ID,
      storeId: STORE_ID,
      idempotencyKey: 'idem-adopted-order',
      ...overrides,
    });

    beforeEach(async () => {
      prismaMock = createPrismaMock({
        orders: ['findUnique', 'update'],
        payments: ['create', 'update', 'findFirst'],
        store_payment_methods: ['findFirst', 'findUnique'],
        stores: ['findUnique'],
      });

      prismaMock.store_payment_methods.findFirst.mockResolvedValue(
        paymentMethodRow,
      );
      prismaMock.store_payment_methods.findUnique.mockResolvedValue(
        paymentMethodRow,
      );
      prismaMock.stores.findUnique.mockResolvedValue({
        id: STORE_ID,
        organization_id: 1,
      });
      prismaMock.payments.create.mockResolvedValue({
        id: 5001,
        transaction_id: 'txn-created',
      });
      prismaMock.payments.update.mockResolvedValue({ id: 5001 });
      prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentGatewayService,
          // Validador REAL — es la compuerta bajo prueba.
          PaymentValidatorService,
          { provide: StorePrismaService, useValue: prismaMock },
          {
            provide: S3Service,
            useValue: { getPresignedUrl: jest.fn().mockResolvedValue(null) },
          },
        ],
      }).compile();

      gateway = module.get<PaymentGatewayService>(PaymentGatewayService);

      processor = {
        isEnabled: jest.fn().mockReturnValue(true),
        processPayment: jest.fn().mockResolvedValue({
          success: true,
          status: payments_state_enum.succeeded,
          transactionId: 'txn-processor',
        } satisfies PaymentResult),
      };
      gateway.registerProcessor('cash', processor as any);
    });

    it('rechaza el segundo cobro de una orden ya pagada aunque el body traiga metadata.is_pos_payment', async () => {
      // grand_total 59.50 ya cubierto por un pago `succeeded` de 59.50:
      // saldo pendiente = 0, así que el validador devuelve el 409 tipado.
      prismaMock.orders.findUnique.mockResolvedValue(
        buildOrder({
          id: ORDER_ID,
          store_id: STORE_ID,
          state: 'finished',
          grand_total: new Prisma.Decimal('59.50'),
          payments: [
            buildPayment({
              state: 'succeeded',
              amount: new Prisma.Decimal('59.50'),
            }),
          ],
        }),
      );

      await expect(
        gateway.processPayment(
          posCharge({ metadata: { is_pos_payment: true } }),
        ),
      ).rejects.toMatchObject({
        errorCode: 'ORD_PAY_ALREADY_PAID_001',
      });

      // Ninguna plata se mueve ni se persiste cuando la compuerta rechaza.
      expect(processor.processPayment).not.toHaveBeenCalled();
      expect(prismaMock.payments.create).not.toHaveBeenCalled();
    });

    it('rechaza el cobro de una orden cancelada aunque el body traiga metadata.is_pos_payment', async () => {
      prismaMock.orders.findUnique.mockResolvedValue(
        buildOrder({
          id: ORDER_ID,
          store_id: STORE_ID,
          state: 'cancelled',
          grand_total: new Prisma.Decimal('59.50'),
          payments: [],
        }),
      );

      await expect(
        gateway.processPayment(
          posCharge({ metadata: { is_pos_payment: true } }),
        ),
      ).rejects.toMatchObject({
        code: PaymentErrorCodes.INVALID_ORDER,
      });

      expect(processor.processPayment).not.toHaveBeenCalled();
      expect(prismaMock.payments.create).not.toHaveBeenCalled();
    });

    it('deja pasar el cobro legítimo de una orden adoptada sin que el cliente afirme nada', async () => {
      prismaMock.orders.findUnique.mockResolvedValue(
        buildOrder({
          id: ORDER_ID,
          store_id: STORE_ID,
          state: 'created',
          grand_total: new Prisma.Decimal('59.50'),
          payments: [],
        }),
      );

      const result = await gateway.processPayment(posCharge());

      expect(result.success).toBe(true);
      expect(processor.processPayment).toHaveBeenCalledTimes(1);
    });

    const validateMetadata = async (metadata: Record<string, unknown>) => {
      // Mismas opciones que el ValidationPipe global de main.ts.
      const dto = plainToInstance(
        CreatePaymentDto,
        {
          orderId: ORDER_ID,
          amount: 59.5,
          currency: 'COP',
          storePaymentMethodId: PAYMENT_METHOD_ID,
          storeId: STORE_ID,
          metadata,
        },
        { enableImplicitConversion: true },
      );
      return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    };

    it('CreatePaymentDto rechaza una llave no declarada dentro de metadata (forbidNonWhitelisted recurre)', async () => {
      const errors = await validateMetadata({ skip_amount_validation: true });

      const metadataError = errors.find((e) => e.property === 'metadata');
      expect(metadataError?.children?.map((c) => c.property)).toContain(
        'skip_amount_validation',
      );
    });

    it('CreatePaymentDto acepta is_pos_payment del POS anterior (compat de un release; el gateway lo ignora)', async () => {
      const errors = await validateMetadata({ is_pos_payment: true });

      expect(errors).toEqual([]);
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
