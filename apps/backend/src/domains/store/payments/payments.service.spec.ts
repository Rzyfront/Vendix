import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentGatewayService, PaymentValidatorService } from './services';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { PaymentError, PaymentErrorCodes } from './utils';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { payments_state_enum } from '@prisma/client';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { TaxesService } from '../taxes/taxes.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../coupons/coupons.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { PaymentEncryptionService } from './services/payment-encryption.service';
import { InvoiceDataRequestsService } from '../invoicing/invoice-data-requests/invoice-data-requests.service';
import { WompiClientFactory } from './processors/wompi/wompi.factory';
import { WompiProcessor } from './processors/wompi/wompi.processor';

/**
 * Tests for PaymentsService focused on the POS sale recalculation flow:
 *  - The backend (not the frontend) is the source of truth for promotional
 *    and coupon discounts.
 *  - `calculatePosPromotionQuote` delegates to `PromotionEngineService.quoteDiscounts`
 *    and returns the persistence-ready snapshots.
 *  - `calculatePosCouponDiscount` delegates to `CouponsService.validate` and
 *    returns the server-recalculated coupon discount (separate from the
 *    promotional discount).
 *  - Any `discount_amount` sent by the frontend in the POS payload is ignored
 *    for final totals.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentGateway: PaymentGatewayService;
  let prisma: StorePrismaService;
  let promotionEngine: PromotionEngineService;
  let couponsService: CouponsService;

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

    const mockPromotionEngine = {
      quoteDiscounts: jest.fn(),
      applyPromotion: jest.fn(),
      validatePromotion: jest.fn(),
    };

    const mockCouponsService = {
      validate: jest.fn(),
      registerUse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentGatewayService, useValue: mockPaymentGateway },
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: PaymentValidatorService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        {
          provide: StockLevelManager,
          useValue: { updateStock: jest.fn() },
        },
        {
          provide: TaxesService,
          useValue: { calculateProductTaxes: jest.fn() },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: SettingsService,
          useValue: {
            getSettings: jest.fn().mockResolvedValue({}),
            getStoreCurrency: jest.fn().mockResolvedValue('COP'),
          },
        },
        { provide: PromotionEngineService, useValue: mockPromotionEngine },
        { provide: CouponsService, useValue: mockCouponsService },
        {
          provide: SessionsService,
          useValue: { getActiveSession: jest.fn() },
        },
        {
          provide: MovementsService,
          useValue: { recordSaleMovement: jest.fn() },
        },
        {
          provide: PaymentEncryptionService,
          useValue: { decryptConfig: jest.fn() },
        },
        {
          provide: InvoiceDataRequestsService,
          useValue: { createRequest: jest.fn() },
        },
        {
          provide: WompiClientFactory,
          useValue: { getClient: jest.fn() },
        },
        {
          provide: WompiProcessor,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentGateway = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
    promotionEngine = module.get<PromotionEngineService>(PromotionEngineService);
    couponsService = module.get<CouponsService>(CouponsService);
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

      const callArg = (paymentGateway.processPayment as jest.Mock).mock
        .calls[0][0];
      Object.entries(createPaymentDto).forEach(([key, value]) => {
        expect(callArg[key]).toEqual(value);
      });
      expect(typeof callArg.idempotencyKey).toBe('string');
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

      await expect(
        service.processPayment(createPaymentDto, mockUser),
      ).rejects.toBeDefined();
    });

    it('should validate user access to store', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 2,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(prisma.stores, 'findUnique')
        .mockResolvedValue({ organization_id: 99 } as any);

      await expect(
        service.processPayment(createPaymentDto, mockUser),
      ).rejects.toBeDefined();
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

      jest
        .spyOn(prisma.payments, 'findFirst')
        .mockResolvedValue(mockPayment as any);
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

      await expect(
        service.refundPayment('nonexistent_payment', refundDto, mockUser),
      ).rejects.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return payment by transaction ID', async () => {
      const paymentId = 'txn_1234567890_abc123';

      const mockPayment: any = {
        id: 1,
        transaction_id: paymentId,
        amount: 100.0,
        currency: 'USD',
        state: payments_state_enum.succeeded,
        orders: { ...mockOrder, store_id: 1 },
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

      await expect(
        service.findOne(paymentId, mockUser),
      ).rejects.toBeDefined();
    });
  });

  /**
   * Server-side recalculation of promotions for POS sales.
   *
   * `calculatePosPromotionQuote` is a thin wrapper that builds a
   * `PromotionQuoteInput` from the POS payload and delegates to
   * `PromotionEngineService.quoteDiscounts`. The tests below assert the
   * mapping is correct and the result is returned verbatim — covering the
   * 4 promotion scopes the plan requires: none, product, category, general.
   */
  describe('calculatePosPromotionQuote (POS server-side recalculation)', () => {
    const buildDto = (overrides: any = {}) => ({
      store_id: 1,
      items: [
        {
          product_id: 10,
          category_id: 5,
          category_ids: [5],
          product_name: 'P1',
          quantity: 2,
          unit_price: 50,
          final_unit_price: 50,
          total_price: 100,
        },
      ],
      subtotal: 100,
      total_amount: 100,
      ...overrides,
    });

    it('returns zero discount when no promotions match (regression: sale without promo unchanged)', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 0,
        promotional_subtotal: 100,
        applied_promotions: [],
        items: [],
        order_promotions_snapshot: [],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto(),
      );

      const callArg = (promotionEngine.quoteDiscounts as jest.Mock).mock
        .calls[0][0];
      expect(callArg.manual_promotion_ids).toEqual([]);
      expect(callArg.items).toHaveLength(1);
      expect(callArg.items[0].product_id).toBe(10);
      expect(result.total_discount).toBe(0);
      expect(result.order_promotions_snapshot).toEqual([]);
    });

    it('returns product-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 10,
        promotional_subtotal: 90,
        applied_promotions: [
          {
            promotion_id: 7,
            name: 'Product promo',
            code: null,
            type: 'percentage',
            scope: 'product',
            value: 10,
            is_auto_apply: false,
            discount_amount: 10,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 7, discount_amount: 10 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto({ promotion_ids: [7] }),
      );

      const callArg = (promotionEngine.quoteDiscounts as jest.Mock).mock
        .calls[0][0];
      expect(callArg.manual_promotion_ids).toEqual([7]);
      expect(result.total_discount).toBe(10);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 7, discount_amount: 10 },
      ]);
    });

    it('returns category-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 15,
        promotional_subtotal: 85,
        applied_promotions: [
          {
            promotion_id: 8,
            name: 'Cat promo',
            code: null,
            type: 'percentage',
            scope: 'category',
            value: 15,
            is_auto_apply: false,
            discount_amount: 15,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 8, discount_amount: 15 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto({ promotion_ids: [8] }),
      );

      expect(result.total_discount).toBe(15);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 8, discount_amount: 15 },
      ]);
    });

    it('returns order/general-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 20,
        promotional_subtotal: 80,
        applied_promotions: [
          {
            promotion_id: 9,
            name: 'Order promo',
            code: null,
            type: 'fixed_amount',
            scope: 'order',
            value: 20,
            is_auto_apply: true,
            discount_amount: 20,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 9, discount_amount: 20 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto(),
      );

      expect(result.total_discount).toBe(20);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 9, discount_amount: 20 },
      ]);
    });
  });

  /**
   * Server-side recalculation of the coupon discount.
   *
   * `calculatePosCouponDiscount` delegates to `CouponsService.validate` and
   * intentionally ignores any `discount_amount` sent by the frontend.
   */
  describe('calculatePosCouponDiscount (POS server-side recalculation)', () => {
    const baseDto: any = {
      items: [
        {
          product_id: 10,
          quantity: 2,
          unit_price: 50,
          final_unit_price: 50,
          product_name: 'P1',
          total_price: 100,
        },
      ],
    };

    it('returns 0 when no coupon code is provided', async () => {
      const res = await (service as any).calculatePosCouponDiscount(
        baseDto,
        100,
        0,
      );
      expect(res).toEqual({
        coupon_id: null,
        coupon_code: null,
        discount_amount: 0,
      });
      expect(couponsService.validate).not.toHaveBeenCalled();
    });

    it('returns the validated coupon discount when only a coupon applies', async () => {
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'OFF10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 10,
      });

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_code: 'OFF10' },
        100,
        0,
      );

      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OFF10',
          cart_subtotal: 100,
        }),
      );
      expect(res).toEqual({
        coupon_id: 42,
        coupon_code: 'OFF10',
        discount_amount: 10,
      });
    });

    it('passes remaining subtotal (after promotions) to coupon validation when both are stacked', async () => {
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'OFF10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 9,
      });

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_code: 'OFF10' },
        100,
        10, // promotions already discounted 10 — remaining = 90
      );

      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OFF10',
          cart_subtotal: 90,
        }),
      );
      expect(res.discount_amount).toBe(9);
    });

    it('returns 0 when coupon validation throws (silent failure preserves sale)', async () => {
      (couponsService.validate as jest.Mock).mockRejectedValue(
        new BadRequestException('Coupon expired'),
      );

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_code: 'EXPIRED' },
        100,
        0,
      );

      expect(res).toEqual({
        coupon_id: null,
        coupon_code: null,
        discount_amount: 0,
      });
    });
  });
});
