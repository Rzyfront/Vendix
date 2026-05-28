import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckoutService } from './checkout.service';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CartService } from '../cart/cart.service';
import { TaxesService } from '../../store/taxes/taxes.service';
import { SettingsService } from '../../store/settings/settings.service';
import { StockLevelManager } from '../../store/inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../../store/inventory/shared/services/stock-validator.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { WompiClientFactory } from '../../store/payments/processors/wompi/wompi.factory';
import { WompiProcessor } from '../../store/payments/processors/wompi/wompi.processor';
import { PaymentEncryptionService } from '../../store/payments/services/payment-encryption.service';
import { WebhookHandlerService } from '../../store/payments/services/webhook-handler.service';
import { ReservationsService } from '../../store/reservations/reservations.service';
import { InvoiceDataRequestsService } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.service';
import { InvoicingService } from '../../store/invoicing/invoicing.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { CustomersService } from '../../store/customers/customers.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../../store/coupons/coupons.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Tests for ecommerce CheckoutService promotion/coupon recalculation.
 *
 * The service has many collaborators that aren't relevant to the discount
 * flow — they're all stubbed with no-op mocks. The interesting expectations
 * focus on:
 *  - `quoteDiscounts` is invoked with the right items/categories/customer
 *  - `coupon_code` triggers `CouponsService.validate` exactly once
 *  - `orders.create` receives the correct `subtotal_amount`, `discount_amount`
 *    and `grand_total` (= subtotal + taxes - discount + shipping)
 *  - `applyPromotion` + `registerUse` run AFTER the order is created
 *  - Wompi/manual payments use the order's `grand_total`
 *  - WhatsApp checkout shares the same logic and returns discount fields
 *  - Invalid coupon aborts the checkout with a VendixHttpException
 */

const PRODUCT_BASE = {
  id: 100,
  name: 'Producto Base',
  base_price: 10000,
  is_on_sale: false,
  sale_price: null,
  cost_price: 5000,
  product_type: 'physical',
  requires_shipping: false,
  track_inventory: false,
  product_tax_assignments: [],
};

const PRODUCT_CATEGORY = {
  ...PRODUCT_BASE,
  id: 200,
  name: 'Producto Categoria',
  base_price: 20000,
};

function buildProduct(over: Partial<typeof PRODUCT_BASE> = {}) {
  return { ...PRODUCT_BASE, ...over };
}

describe('CheckoutService - promotions and coupons', () => {
  let service: CheckoutService;
  let prisma: any;
  let storePrisma: any;
  // Use `any` so jest mock methods (quoteDiscounts, applyPromotion) don't
  // get filtered out by the strict shape of jest.Mocked<...>.
  let promotionEngine: any;
  let couponsService: any;
  let priceResolverService: any;
  let taxesService: any;
  let settingsService: any;
  let cartService: any;

  const STORE_ID = 1;
  const USER_ID = 42;

  beforeEach(async () => {
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(undefined);

    // Default empty quote shape — individual tests override.
    promotionEngine = {
      quoteDiscounts: jest.fn().mockResolvedValue({
        subtotal: 0,
        total_discount: 0,
        promotional_subtotal: 0,
        applied_promotions: [],
        items: [],
        order_promotions_snapshot: [],
      }),
      applyPromotion: jest.fn().mockResolvedValue(undefined),
    } as any;

    couponsService = {
      validate: jest.fn(),
      registerUse: jest.fn().mockResolvedValue(undefined),
    } as any;

    priceResolverService = {
      resolvePrice: jest.fn(({ product }: any) => ({
        unitPrice: Number(product.base_price),
        unitPriceWithTax: Number(product.base_price),
        unitBasePrice: Number(product.base_price),
      })),
    };

    taxesService = {
      calculateProductTaxes: jest.fn().mockResolvedValue({
        total_rate: 0,
        total_tax_amount: 0,
        taxes: [],
      }),
    };

    settingsService = {
      getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      getSettings: jest.fn().mockResolvedValue({}),
    };

    cartService = {
      clearCart: jest.fn().mockResolvedValue({ success: true }),
    };

    // ecommerce-scoped prisma: only the operations checkout uses.
    prisma = {
      carts: { findFirst: jest.fn().mockResolvedValue(null) },
      products: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.id === PRODUCT_BASE.id) return Promise.resolve(buildProduct());
          if (where.id === PRODUCT_CATEGORY.id)
            return Promise.resolve(buildProduct({ ...PRODUCT_CATEGORY }));
          return Promise.resolve(null);
        }),
      },
      product_variants: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          state: 'enabled',
          system_payment_method: {
            id: 1,
            display_name: 'Cash',
            type: 'cash',
            provider: 'manual',
          },
        }),
      },
      addresses: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orders: {
        create: jest.fn(),
      },
      payments: {
        create: jest.fn().mockResolvedValue({ id: 999, state: 'pending' }),
      },
      stores: { findUnique: jest.fn().mockResolvedValue({ store_code: 'EC' }) },
      users: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ first_name: 'Test', last_name: 'User', phone: null }),
      },
    };

    storePrisma = {
      product_categories: {
        findMany: jest.fn(({ where }: any) => {
          const ids = where.product_id.in as number[];
          const out: Array<{ product_id: number; category_id: number }> = [];
          if (ids.includes(PRODUCT_CATEGORY.id)) {
            out.push({ product_id: PRODUCT_CATEGORY.id, category_id: 555 });
          }
          return Promise.resolve(out);
        }),
      },
      orders: { count: jest.fn().mockResolvedValue(0) },
      shipping_rates: { findFirst: jest.fn() },
      shipping_methods: { findFirst: jest.fn() },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(null) },
      dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_data_requests: { update: jest.fn() },
      store_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      organizations: { findUnique: jest.fn().mockResolvedValue(null) },
      payments: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      store_payment_methods: { findFirst: jest.fn() },
      domain_settings: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: storePrisma },
        { provide: CartService, useValue: cartService },
        { provide: TaxesService, useValue: taxesService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SettingsService, useValue: settingsService },
        {
          provide: StockLevelManager,
          useValue: {
            reserveStock: jest.fn().mockResolvedValue(undefined),
            getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: StockValidatorService,
          useValue: {
            resolveEffectiveTracking: jest.fn().mockReturnValue(false),
            validateAvailability: jest
              .fn()
              .mockResolvedValue({ isAvailable: true, available: 100 }),
          },
        },
        { provide: PriceResolverService, useValue: priceResolverService },
        { provide: WompiClientFactory, useValue: { getClient: jest.fn() } },
        { provide: WompiProcessor, useValue: {} },
        { provide: PaymentEncryptionService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        { provide: ReservationsService, useValue: { create: jest.fn() } },
        {
          provide: InvoiceDataRequestsService,
          useValue: {
            createRequest: jest
              .fn()
              .mockResolvedValue({ id: 1, token: 'tok-guest' }),
          },
        },
        { provide: InvoicingService, useValue: { createFromOrder: jest.fn() } },
        {
          provide: OperatingScopeService,
          useValue: {
            getOperatingScope: jest.fn().mockResolvedValue('STORE'),
            findCentralWarehouse: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: FiscalStatusService,
          useValue: {
            getStoreInvoicingState: jest.fn().mockResolvedValue('INACTIVE'),
          },
        },
        { provide: S3Service, useValue: { signUrl: jest.fn(), uploadFile: jest.fn() } },
        {
          provide: S3PathHelper,
          useValue: { buildReceiptPath: jest.fn(() => 'receipts/test') },
        },
        {
          provide: CustomersService,
          useValue: {
            resolveGuestCustomerForCheckout: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: PromotionEngineService, useValue: promotionEngine },
        { provide: CouponsService, useValue: couponsService },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockOrderCreate(grandTotal: number) {
    prisma.orders.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 1,
        store_id: STORE_ID,
        order_number: data.order_number,
        grand_total: grandTotal,
        currency: data.currency,
        state: data.state,
        order_items: [],
      }),
    );
  }

  describe('checkout() — normal ecommerce flow', () => {
    it('creates a guest checkout WITHOUT promotions (regression)', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined);
      mockOrderCreate(10000);

      const result: any = await service.checkout({
        payment_method_id: 7,
        items: [{ product_id: PRODUCT_BASE.id, quantity: 1 }],
      } as any);

      expect(promotionEngine.quoteDiscounts).toHaveBeenCalledTimes(1);
      expect(couponsService.validate).not.toHaveBeenCalled();
      expect(promotionEngine.applyPromotion).not.toHaveBeenCalled();
      expect(couponsService.registerUse).not.toHaveBeenCalled();

      const orderArgs = prisma.orders.create.mock.calls[0][0].data;
      expect(orderArgs.subtotal_amount).toBe(10000);
      expect(orderArgs.discount_amount).toBe(0);
      expect(orderArgs.grand_total).toBe(10000);

      // Payment created for the same grand_total — never the cart-side estimate.
      expect(prisma.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 10000 }),
        }),
      );
      expect(result.total).toBe(10000);
      expect(result.discount_amount).toBe(0);
    });

    it('applies an automatic promotion for an authenticated customer', async () => {
      promotionEngine.quoteDiscounts.mockResolvedValue({
        subtotal: 10000,
        total_discount: 1500,
        promotional_subtotal: 8500,
        applied_promotions: [
          {
            promotion_id: 7,
            name: 'Auto promo',
            code: null,
            type: 'percentage',
            scope: 'order',
            value: 15,
            is_auto_apply: true,
            discount_amount: 1500,
            applicable_item_ids: [0],
          },
        ],
        items: [
          {
            line_id: 0,
            product_id: PRODUCT_BASE.id,
            variant_id: null,
            quantity: 1,
            original_unit_price: 10000,
            promotion_discount: 1500,
            final_unit_price: 8500,
            final_line_total: 8500,
            promotion_ids: [7],
          },
        ],
        order_promotions_snapshot: [
          { promotion_id: 7, discount_amount: 1500 },
        ],
      });

      mockOrderCreate(8500);

      const result: any = await service.checkout({
        payment_method_id: 7,
        items: [{ product_id: PRODUCT_BASE.id, quantity: 1 }],
      } as any);

      const orderArgs = prisma.orders.create.mock.calls[0][0].data;
      expect(orderArgs.discount_amount).toBe(1500);
      expect(orderArgs.grand_total).toBe(8500);

      expect(promotionEngine.applyPromotion).toHaveBeenCalledWith(
        1,
        7,
        1500,
        USER_ID,
      );
      expect(couponsService.registerUse).not.toHaveBeenCalled();

      expect(prisma.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 8500 }),
        }),
      );
      expect(result.total).toBe(8500);
      expect(result.promotion_discount).toBe(1500);
      expect(result.coupon_discount).toBe(0);
    });

    it('applies a category-scoped promotion using product_categories lookup', async () => {
      // Cart has a single product belonging to category 555. The promotion
      // engine receives `category_ids` resolved from product_categories.
      promotionEngine.quoteDiscounts.mockImplementation(async (input) => {
        // Confirm the engine receives the resolved category_ids array.
        expect(input.items[0].category_ids).toEqual([555]);
        return {
          subtotal: 20000,
          total_discount: 2000,
          promotional_subtotal: 18000,
          applied_promotions: [
            {
              promotion_id: 9,
              name: 'Categoria',
              code: null,
              type: 'fixed_amount',
              scope: 'category',
              value: 2000,
              is_auto_apply: true,
              discount_amount: 2000,
              applicable_item_ids: [0],
            },
          ],
          items: [
            {
              line_id: 0,
              product_id: PRODUCT_CATEGORY.id,
              variant_id: null,
              quantity: 1,
              original_unit_price: 20000,
              promotion_discount: 2000,
              final_unit_price: 18000,
              final_line_total: 18000,
              promotion_ids: [9],
            },
          ],
          order_promotions_snapshot: [
            { promotion_id: 9, discount_amount: 2000 },
          ],
        };
      });

      mockOrderCreate(18000);

      await service.checkout({
        payment_method_id: 7,
        items: [{ product_id: PRODUCT_CATEGORY.id, quantity: 1 }],
      } as any);

      const orderArgs = prisma.orders.create.mock.calls[0][0].data;
      expect(orderArgs.discount_amount).toBe(2000);
      expect(orderArgs.grand_total).toBe(18000);
      expect(promotionEngine.applyPromotion).toHaveBeenCalledWith(
        1,
        9,
        2000,
        USER_ID,
      );
    });

    it('stacks a promotion AND a coupon, then registers usage', async () => {
      promotionEngine.quoteDiscounts.mockResolvedValue({
        subtotal: 10000,
        total_discount: 1000,
        promotional_subtotal: 9000,
        applied_promotions: [
          {
            promotion_id: 7,
            name: 'Promo',
            code: null,
            type: 'percentage',
            scope: 'order',
            value: 10,
            is_auto_apply: true,
            discount_amount: 1000,
            applicable_item_ids: [0],
          },
        ],
        items: [
          {
            line_id: 0,
            product_id: PRODUCT_BASE.id,
            variant_id: null,
            quantity: 1,
            original_unit_price: 10000,
            promotion_discount: 1000,
            final_unit_price: 9000,
            final_line_total: 9000,
            promotion_ids: [7],
          },
        ],
        order_promotions_snapshot: [
          { promotion_id: 7, discount_amount: 1000 },
        ],
      });

      couponsService.validate.mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'PROMO10',
        name: 'Promo 10',
        discount_type: 'FIXED_AMOUNT',
        discount_value: 500,
        discount_amount: 500,
        min_purchase_amount: null,
        max_discount_amount: null,
      } as any);

      mockOrderCreate(8500);

      // Wompi method to ensure totals propagate to the payment amount.
      prisma.store_payment_methods.findFirst.mockResolvedValue({
        id: 7,
        state: 'enabled',
        system_payment_method: { type: 'wompi', provider: 'wompi' },
      });

      const result: any = await service.checkout({
        payment_method_id: 7,
        items: [{ product_id: PRODUCT_BASE.id, quantity: 1 }],
        coupon_code: 'PROMO10',
      } as any);

      expect(couponsService.validate).toHaveBeenCalledTimes(1);
      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'PROMO10',
          cart_subtotal: 9000, // post-promo subtotal
          customer_id: USER_ID,
        }),
      );

      const orderArgs = prisma.orders.create.mock.calls[0][0].data;
      expect(orderArgs.subtotal_amount).toBe(10000);
      expect(orderArgs.discount_amount).toBe(1500);
      expect(orderArgs.grand_total).toBe(8500);

      // Payment amount === order grand_total (the only authoritative value
      // Wompi/manual must charge).
      expect(prisma.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 8500 }),
        }),
      );

      expect(promotionEngine.applyPromotion).toHaveBeenCalledWith(
        1,
        7,
        1000,
        USER_ID,
      );
      expect(couponsService.registerUse).toHaveBeenCalledWith(
        42,
        1,
        USER_ID,
        500,
      );
      expect(result.promotion_discount).toBe(1000);
      expect(result.coupon_discount).toBe(500);
      expect(result.discount_amount).toBe(1500);
    });

    it('rejects an invalid coupon and never creates an order', async () => {
      couponsService.validate.mockRejectedValue(
        new VendixHttpException({
          code: 'CPN_FIND_001',
          httpStatus: 404,
          devMessage: 'Coupon not found',
        }),
      );

      await expect(
        service.checkout({
          payment_method_id: 7,
          items: [{ product_id: PRODUCT_BASE.id, quantity: 1 }],
          coupon_code: 'NOPE',
        } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);

      expect(prisma.orders.create).not.toHaveBeenCalled();
      expect(prisma.payments.create).not.toHaveBeenCalled();
      expect(promotionEngine.applyPromotion).not.toHaveBeenCalled();
      expect(couponsService.registerUse).not.toHaveBeenCalled();
    });
  });

  describe('whatsappCheckout() — promotions share the same source of truth', () => {
    it('applies automatic promotions and returns discount details', async () => {
      promotionEngine.quoteDiscounts.mockResolvedValue({
        subtotal: 10000,
        total_discount: 1500,
        promotional_subtotal: 8500,
        applied_promotions: [
          {
            promotion_id: 11,
            name: 'WA promo',
            code: null,
            type: 'percentage',
            scope: 'order',
            value: 15,
            is_auto_apply: true,
            discount_amount: 1500,
            applicable_item_ids: [0],
          },
        ],
        items: [
          {
            line_id: 0,
            product_id: PRODUCT_BASE.id,
            variant_id: null,
            quantity: 1,
            original_unit_price: 10000,
            promotion_discount: 1500,
            final_unit_price: 8500,
            final_line_total: 8500,
            promotion_ids: [11],
          },
        ],
        order_promotions_snapshot: [
          { promotion_id: 11, discount_amount: 1500 },
        ],
      });

      mockOrderCreate(8500);

      const response: any = await service.whatsappCheckout({
        items: [{ product_id: PRODUCT_BASE.id, quantity: 1 }],
      } as any);

      const orderArgs = prisma.orders.create.mock.calls[0][0].data;
      expect(orderArgs.channel).toBe('whatsapp');
      expect(orderArgs.discount_amount).toBe(1500);
      expect(orderArgs.grand_total).toBe(8500);

      expect(promotionEngine.applyPromotion).toHaveBeenCalledWith(
        1,
        11,
        1500,
        USER_ID,
      );
      // WhatsApp doesn't create a payment row up front (only order); the
      // response is expected to surface the final total and discount fields
      // so the WhatsApp message references the same number.
      expect(response.total).toBe(8500);
      expect(response.discount_amount).toBe(1500);
      expect(response.promotion_discount).toBe(1500);
    });
  });
});
