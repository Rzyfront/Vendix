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
import { FiscalInvoiceThresholdService } from '@common/services/fiscal-invoice-threshold.service';
import { OrderStockCommitService } from '../inventory/shared/services/order-stock-commit.service';
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { WithholdingFlowService } from '../withholding-tax/withholding-flow.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { SerialNumberEnforcementService } from '../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../inventory/serial-numbers/inventory-serial-numbers.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AuditService } from '@common/audit/audit.service';

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
  let fiscalThreshold: FiscalInvoiceThresholdService;
  let kitchenFire: KitchenFireService;

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
      // `processPosPayment` corre todo el cobro dentro de una transacción; el
      // mock ejecuta el callback en línea para poder observar lo que ocurre
      // adentro sin una base de datos.
      $transaction: jest.fn(),
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
            // CP-POS-CREAR-EDITAR-COBRAR-001 — legacy fiscal-threshold tests
            // were authored under the anonymous-allowed assumption
            // (`require_customer_data=false`). Mirror that explicitly so the
            // new customer gate in `processPosPayment` does not fire and
            // re-target these tests' STOP_AFTER_GATE assertion.
            getSettings: jest
              .fn()
              .mockResolvedValue({ checkout: { require_customer_data: false } }),
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
        {
          provide: FiscalInvoiceThresholdService,
          useValue: { assertInvoiceNotRequired: jest.fn(), evaluate: jest.fn() },
        },
        // The canonical stock-commit seam: these cases assert payment behavior,
        // not inventory commitment, so a no-op commit keeps them focused.
        {
          provide: OrderStockCommitService,
          useValue: { commitOrderDelivery: jest.fn() },
        },
        // Collaborators the POS sale path injects but this suite does not
        // exercise (stock spreading, restaurant fire, serial pools). Stubbed so
        // the module compiles; a suite that asserts their behavior must widen
        // these instead of relying on the empty shape.
        {
          provide: SellableStockAllocator,
          useValue: { allocateForOrderItem: jest.fn() },
        },
        {
          provide: PriceResolverService,
          useValue: { resolveEffectivePrice: jest.fn() },
        },
        {
          provide: WithholdingFlowService,
          useValue: { applyToOrder: jest.fn() },
        },
        { provide: KitchenFireService, useValue: { fireOrder: jest.fn() } },
        {
          provide: TableSessionsService,
          useValue: { emitSessionClosed: jest.fn() },
        },
        {
          provide: SerialNumberEnforcementService,
          useValue: { assertSerialsForSale: jest.fn() },
        },
        {
          provide: InventorySerialNumbersService,
          useValue: { consumeForOrder: jest.fn() },
        },
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 añadió `AuditService` al
        // constructor de `PaymentsService`; sin este provider el módulo de
        // test no compila y TODA la suite falla en el `beforeEach`.
        {
          provide: AuditService,
          useValue: {
            logCustom: jest.fn(),
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
            log: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentGateway = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
    promotionEngine = module.get<PromotionEngineService>(PromotionEngineService);
    couponsService = module.get<CouponsService>(CouponsService);
    fiscalThreshold = module.get<FiscalInvoiceThresholdService>(
      FiscalInvoiceThresholdService,
    );
    kitchenFire = module.get<KitchenFireService>(KitchenFireService);
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

  /**
   * QUI-673 — el gate fiscal se apagaba en silencio en cada cobro POS.
   *
   * `orders` no tiene columna `organization_id` (schema.prisma: sólo `store_id`
   * + la relación `stores`), así que leer `order.organization_id` para el
   * umbral de 5 UVT entregaba SIEMPRE `undefined`. `order` está tipado `any` en
   * las dos ramas que lo producen, de modo que TypeScript no lo veía; y como
   * `FiscalGateService.isAreaEnabled` captura cualquier error y falla cerrado,
   * el `findUnique({ where: { id: undefined } })` resultante se degradaba a un
   * WARN y el cobro seguía respondiendo 201. El umbral no se evaluaba nunca.
   *
   * Por eso estos casos assertan el `organization_id` CONCRETO que recibe
   * `assertInvoiceNotRequired`: un stub que sólo verifica "fue llamado" es
   * exactamente lo que dejó pasar la regresión.
   */
  describe('processPosPayment (5 UVT fiscal threshold arguments)', () => {
    // Corta la ejecución justo después del gate fiscal. Lo que sigue dentro de
    // la transacción (pagos, inventario, COGS, asientos) no es lo que estos
    // casos assertan, y stubearlo entero volvería el test frágil sin añadir
    // cobertura sobre el argumento.
    const STOP_AFTER_GATE = 'stop-after-fiscal-threshold';

    let contextSpy: jest.SpyInstance;

    const CONTEXT_ORGANIZATION_ID = 999;

    const arrangePosSale = (order: any) => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: 1,
          organization_id: CONTEXT_ORGANIZATION_ID,
        } as any);

      (prisma as any).$transaction = jest.fn(async (cb: any) => cb({}));

      jest
        .spyOn(service as any, 'createOrUpdateOrderFromPos')
        .mockResolvedValue({
          order,
          hasSerialized: false,
          promotionsSnapshot: [],
          appliedPromotions: [],
          couponInfo: {
            coupon_id: null,
            coupon_code: null,
            discount_amount: 0,
          },
          kitchenFire: null,
          closedSessionId: null,
        });

      (fiscalThreshold.assertInvoiceNotRequired as jest.Mock).mockRejectedValue(
        new Error(STOP_AFTER_GATE),
      );
    };

    const buildPosDto = (overrides: any = {}): any => ({
      store_id: 1,
      currency: 'COP',
      items: [],
      payments: [],
      ...overrides,
    });

    // `super_admin` atraviesa `validateUserAccess` sin tocar la base.
    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: CONTEXT_ORGANIZATION_ID,
      roles: ['super_admin'],
    };

    afterEach(() => {
      contextSpy?.mockRestore();
    });

    it('resolves the organization through order.stores, never through a non-existent orders.organization_id column', async () => {
      // La orden se modela como la devuelve Prisma: SIN `organization_id`, con
      // la organización colgando de la relación `stores`.
      arrangePosSale({
        id: 10,
        store_id: 1,
        grand_total: 400000,
        stores: { id: 1, organization_id: 55 },
      });

      await expect(
        service.processPosPayment(
          buildPosDto({ customer_id: null }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATE);

      expect(fiscalThreshold.assertInvoiceNotRequired).toHaveBeenCalledTimes(1);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];

      // El assert que faltaba: la organización concreta, no "se llamó".
      expect(callArg.organization_id).toBe(55);
      expect(callArg.organization_id).not.toBeUndefined();
      expect(callArg.store_id).toBe(1);
      // El total viene del `grand_total` recalculado por el servidor, no del DTO.
      expect(callArg.total_amount).toBe(400000);
      expect(callArg.has_customer).toBe(false);
      expect(callArg.channel).toBe('pos');
    });

    it('marks the sale as identified when the POS payload carries a customer', async () => {
      arrangePosSale({
        id: 11,
        store_id: 1,
        grand_total: 400000,
        stores: { id: 1, organization_id: 55 },
      });

      await expect(
        service.processPosPayment(buildPosDto({ customer_id: 77 }), posUser),
      ).rejects.toThrow(STOP_AFTER_GATE);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];
      expect(callArg.organization_id).toBe(55);
      expect(callArg.has_customer).toBe(true);
    });

    it('falls back to the request context organization when the order relation is absent', async () => {
      // Red de seguridad: hoy ambas ramas que producen `order` incluyen
      // `stores`, pero si alguna dejara de hacerlo el gate debe seguir
      // recibiendo una organización real en vez de `undefined`.
      arrangePosSale({
        id: 12,
        store_id: 1,
        grand_total: 400000,
      });

      await expect(
        service.processPosPayment(
          buildPosDto({ customer_id: null }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATE);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];
      expect(callArg.organization_id).toBe(CONTEXT_ORGANIZATION_ID);
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

  // ------------------------------------------------------------------
  // CP-POS-CREAR-EDITAR-COBRAR-001 — G.1
  //
  // Invariantes B.1 (customer gate) y B.2 (draft ≠ payment). Ambos gates
  // corren ANTES de `$transaction`, así que la prueba de "cero escrituras"
  // es exactamente: `prisma.$transaction` nunca fue invocada. No hay orden,
  // ni pago, ni fila de cupón, ni evento, porque nada de eso ocurre fuera
  // de la transacción.
  //
  // El caso positivo no simula la venta entera (eso sería un test frágil de
  // 300 líneas de mocks): corta con un sentinel justo después de los gates y
  // asserta que (a) el gate NO disparó, (b) se consultó la membresía del
  // cliente en ESTE store y (c) ni el gateway de pago ni el registro de uso
  // del cupón fueron llamados en el camino de draft.
  // ------------------------------------------------------------------
  describe('processPosPayment — customer gate y draft/payment invariant (B.1/B.2)', () => {
    const STOP_AFTER_GATES = 'stop-after-pos-gates';
    const CONTEXT_STORE_ID = 1;

    let contextSpy: jest.SpyInstance;

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    const buildDto = (overrides: any = {}): any => ({
      store_id: CONTEXT_STORE_ID,
      currency: 'COP',
      items: [{ product_id: 1, quantity: 1, unit_price: 1000 }],
      payments: [],
      total_amount: 1000,
      ...overrides,
    });

    const arrange = (settings: any) => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: CONTEXT_STORE_ID,
          organization_id: 1,
        } as any);

      (
        module_settings_getSettings() as jest.Mock
      ).mockResolvedValue(settings);

      // Si algún gate dejara pasar la petición, la transacción se abriría.
      // El sentinel hace visible ese cruce en lugar de fallar en un mock
      // profundo e inescrutable.
      (prisma as any).$transaction = jest.fn(async () => {
        throw new Error(STOP_AFTER_GATES);
      });
    };

    // `settingsService` no está expuesto como variable del suite; se resuelve
    // desde la instancia del servicio para no reestructurar el módulo de test.
    const module_settings_getSettings = () =>
      (service as any).settingsService.getSettings;

    afterEach(() => {
      contextSpy?.mockRestore();
    });

    it('acepta la creación con cliente válido: pasa los gates, no cobra y no consume cupón', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });

      await expect(
        service.processPosPayment(
          buildDto({
            customer_id: 77,
            coupon_code: 'DESCUENTO10',
            is_draft: true,
            requires_payment: false,
          }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATES);

      // El gate consultó la membresía del cliente EN ESTE STORE.
      expect(prisma.store_users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_id: CONTEXT_STORE_ID, user_id: 77 },
        }),
      );

      // Ni cobro ni consumo de cupón en el camino de draft.
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
      expect((couponsService as any).registerUse).not.toHaveBeenCalled();
    });

    it('rechaza con POS_CUSTOMER_REQUIRED_001 y no abre transacción cuando falta el cliente', async () => {
      arrange({ checkout: { require_customer_data: true } });

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ is_draft: true, requires_payment: false }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_CUSTOMER_REQUIRED_001.code,
      );
      // Cero escrituras: sin transacción no hay orden, ni pago, ni cupón.
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
    });

    it('rechaza con POS_CUSTOMER_REQUIRED_001 cuando el cliente no pertenece al store', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ customer_id: 4242, is_draft: true, requires_payment: false }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_CUSTOMER_REQUIRED_001.code,
      );
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    it('rechaza con POS_DRAFT_REQUIRES_PAYMENT_001 la combinación is_draft + requires_payment', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ customer_id: 77, is_draft: true, requires_payment: true }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_DRAFT_REQUIRES_PAYMENT_001.code,
      );
      // El conflicto se detecta ANTES del gate de cliente y de la transacción.
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
    });

    it('un draft con cupón válido no registra uso ni incrementa el contador', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 9,
        code: 'DESCUENTO10',
        discount_amount: 100,
      });

      await expect(
        service.processPosPayment(
          buildDto({
            customer_id: 77,
            coupon_code: 'DESCUENTO10',
            is_draft: true,
            requires_payment: false,
          }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATES);

      // `coupon_uses` / `coupons.current_uses` sólo se tocan dentro de la
      // transacción de cobro; el draft no llega allí y no registra uso.
      expect((couponsService as any).registerUse).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Table lifecycle contract: a POS sale (deferred or not) MUST NOT close the
  // table session or flip `tables.status` to 'cleaning'. Only the canonical
  // `TableSessionsService.closeSession` owns those transitions. If someone
  // re-introduces the auto-close here, this test fails before the regression
  // reaches production. See PR #698 review note.
  // ---------------------------------------------------------------------------
  describe('applyPosPaymentToTableSession — table lifecycle contract', () => {
    const CONTEXT_STORE_ID = 1;
    let contextSpy: jest.SpyInstance;

    /**
     * Bare `tx` shim. Every Prisma call the private method makes is replaced
     * with a `jest.fn()` so we can assert exactly which writes the path emits
     * and which it never does. Default returns are "empty / ok" so the chain
     * doesn't throw on its way to the close-out block.
     */
    const buildTx = (session: any) => {
      const tx: any = {
        table_sessions: {
          findUnique: jest.fn().mockResolvedValue(session),
          update: jest.fn().mockResolvedValue({}),
        },
        tables: {
          update: jest.fn().mockResolvedValue({}),
        },
        order_items: {
          findMany: jest.fn().mockResolvedValue([]), // existing draft items
          findFirst: jest.fn().mockResolvedValue(null), // KDS candidate scan (line ~3033)
        },
        orders: {
          update: jest.fn().mockImplementation((args: any) =>
            Promise.resolve({
              id: args.where.id,
              order_items: [],
              stores: { id: CONTEXT_STORE_ID, organization_id: 1 },
            }),
          ),
        },
      };
      return tx;
    };

    const arrangeCashSale = () => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: CONTEXT_STORE_ID,
          organization_id: 1,
        } as any);

      const posUser: any = {
        id: 7,
        email: 'cajero@example.com',
        organization_id: 1,
        roles: ['super_admin'],
      };

      const session = {
        id: 99,
        store_id: CONTEXT_STORE_ID,
        table_id: 5,
        order_id: 1001,
        closed_at: null,
        order: { id: 1001, store_id: CONTEXT_STORE_ID },
      };

      const tx = buildTx(session);

      // Promotion/coupon re-evaluation helpers are stubs because the contract
      // we are locking here is the table lifecycle, not the discount engine.
      jest
        .spyOn(service as any, 'calculatePosPromotionQuote')
        .mockResolvedValue({ total_discount: 0, applied: [] });
      jest
        .spyOn(service as any, 'calculatePosCouponDiscount')
        .mockResolvedValue({
          coupon_id: null,
          coupon_code: null,
          discount_amount: 0,
        });

      // The private method pokes `prepareFireContext` and `fireOrderItemsInTx`;
      // their side-effects are out of scope. Returning `null`/`{ firedItemIds: [] }`
      // makes the fire branch a no-op so execution reaches the close-out block.
      (kitchenFire as any).prepareFireContext = jest.fn().mockResolvedValue(null);
      (kitchenFire as any).fireOrderItemsInTx = jest.fn().mockResolvedValue(null);

      return { tx, session, posUser };
    };

    const buildDto = (overrides: any = {}): any => ({
      table_session_id: 99,
      store_id: CONTEXT_STORE_ID,
      currency: 'COP',
      items: [],
      payments: [
        { method: 'cash', amount: 10000, status: 'completed' },
      ],
      ...overrides,
    });

    afterEach(() => {
      contextSpy?.mockRestore();
      jest.restoreAllMocks();
    });

    it('POS cash sale keeps the table session OPEN and the table `occupied`', async () => {
      const { tx, posUser } = arrangeCashSale();

      const result = await (
        service as any
      ).applyPosPaymentToTableSession(
        tx,
        buildDto(),
        posUser,
        CONTEXT_STORE_ID,
      );

      // Contract — locked by review on PR #698:
      //   1. `tx.table_sessions.update` MUST NEVER close the session here;
      //      the canonical `TableSessionsService.closeSession` owns that
      //      transition. Using `not.toHaveBeenCalledWith(...)` instead of
      //      a flat `not.toHaveBeenCalled()` so the test only breaks if a
      //      future change reintroduces the forbidden mutation, not for
      //      legitimate (e.g. `updated_at`) writes.
      //   2. `tx.tables.update` MUST NEVER flip the table to `cleaning`
      //      here; that flip belongs to `closeSession` too.
      //   3. `result.closedSessionId` MUST be null so the post-commit
      //      `session_closed` SSE emission stays gated on the canonical
      //      close path.
      expect(tx.table_sessions.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ closed_at: expect.anything() }),
        }),
      );
      expect(tx.tables.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cleaning' }),
        }),
      );
      expect(result.closedSessionId).toBeNull();
    });
  });
});
