import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckoutService } from './checkout.service';
import { CheckoutIdempotencyService } from './checkout-idempotency.service';
import { StorefrontPriceService } from '../shared/services/storefront-price.service';
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
import { PaymentGatewayService } from '../../store/payments/services/payment-gateway.service';
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
import { FiscalInvoiceThresholdService } from '@common/services/fiscal-invoice-threshold.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';
import { RequestContextService } from '@common/context/request-context.service';

/** Precio con impuesto por línea en las respuestas del checkout (aditivo). */
const INC8_ROWS = [
  {
    tax_rate_id: 68,
    name: 'INC',
    rate: 0.08,
    tax_type: 'inc',
    is_inclusive: true,
  },
];

function buildProduct(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Postre INC',
    price: 1000,
    base_price: 1000,
    is_on_sale: false,
    sale_price: null,
    cost_price: 500,
    product_type: 'physical',
    requires_shipping: false,
    track_inventory: false,
    is_sellable: true,
    product_tax_assignments: [],
    ...over,
  };
}

describe('CheckoutService — precio con impuesto por línea (gross)', () => {
  let service: CheckoutService;
  let prisma: any;
  let warn: jest.Mock;

  const STORE_ID = 1;
  const USER_ID = 42;

  async function boot(products: Record<number, any>, taxRows: any[] = INC8_ROWS) {
    warn = jest.fn();

    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(undefined);

    prisma = {
      carts: { findFirst: jest.fn().mockResolvedValue(null) },
      products: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(products[where.id] ?? null),
        ),
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
            id: 2,
            display_name: 'Transferencia',
            type: 'bank_transfer',
            provider: 'manual',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product_price_tier_assignments: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      product_price_tier_overrides: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      addresses: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orders: { create: jest.fn() },
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

    const storePrisma: any = {
      shipping_methods: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
      orders: { count: jest.fn().mockResolvedValue(0) },
      shipping_rates: { findFirst: jest.fn() },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(null) },
      dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_data_requests: { update: jest.fn() },
      store_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      organizations: { findUnique: jest.fn().mockResolvedValue(null) },
      payments: { findFirst: jest.fn(), update: jest.fn() },
      store_payment_methods: { findFirst: jest.fn() },
      domain_settings: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: storePrisma },
        // `markCartConverted` NO es opcional: `runCheckout` lo llama en
        // `checkout.service.ts:1842` en cuanto la orden tiene cliente
        // resuelto (QUI-628). Sin él, el doble revienta con
        // «this.cart_service.markCartConverted is not a function» DESPUÉS de
        // crear la orden, y el fallo aparece disfrazado de error de cálculo.
        {
          provide: CartService,
          useValue: {
            clearCart: jest.fn().mockResolvedValue({ success: true }),
            markCartConverted: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TaxesService,
          useValue: {
            calculateProductTaxes: jest.fn().mockResolvedValue({
              total_rate: 0.08,
              total_tax_amount: 0,
              base: 0,
              total: 0,
              taxes: taxRows,
            }),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: SettingsService,
          useValue: {
            getStoreCurrency: jest.fn().mockResolvedValue('COP'),
            getSettings: jest.fn().mockResolvedValue({}),
          },
        },
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
        {
          provide: PriceResolverService,
          useValue: { resolvePrice: jest.fn(({ product }: any) => ({
            unitPrice: Number(product.base_price),
            unitPriceWithTax: Number(product.base_price),
            unitBasePrice: Number(product.base_price),
          })) },
        },
        { provide: WompiClientFactory, useValue: { getClient: jest.fn() } },
        { provide: WompiProcessor, useValue: {} },
        { provide: PaymentEncryptionService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        {
          provide: PaymentGatewayService,
          useValue: {
            resolveAndValidateBankAccount: jest.fn(async (id: number) => ({
              id, name: null, bank_name: 'mock', account_number: '000', currency: 'COP',
            })),
          },
        },
        { provide: ReservationsService, useValue: { create: jest.fn() } },
        {
          provide: InvoiceDataRequestsService,
          useValue: { createRequest: jest.fn().mockResolvedValue({ id: 1, token: 'tok' }) },
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
          useValue: { getStoreInvoicingState: jest.fn().mockResolvedValue('INACTIVE') },
        },
        { provide: S3Service, useValue: { signUrl: jest.fn(), uploadFile: jest.fn(), getPresignedUrl: jest.fn().mockResolvedValue(null) } },
        { provide: S3PathHelper, useValue: { buildReceiptPath: jest.fn(() => 'receipts/test') } },
        {
          provide: CustomersService,
          useValue: { resolveGuestCustomerForCheckout: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: PromotionEngineService,
          useValue: {
            quoteDiscounts: jest.fn().mockResolvedValue({
              subtotal: 0, total_discount: 0, promotional_subtotal: 0,
              applied_promotions: [], items: [], order_promotions_snapshot: [],
            }),
            applyPromotion: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CouponsService, useValue: { validate: jest.fn(), registerUse: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: FiscalInvoiceThresholdService,
          useValue: { assertInvoiceNotRequired: jest.fn(), evaluate: jest.fn() },
        },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: { getBlockedProductIds: jest.fn().mockResolvedValue(new Set<number>()) },
        },
        {
          provide: StorefrontPriceService,
          useValue: {
            resolveLine: jest.fn(({ product }: any) => ({
              net_unit_price: Number(product?.price ?? 0),
              gross_unit_price: Number(product?.price ?? 0),
              compare_at_price: null,
              tax_rate: 0,
              applied_price_tier_id: null,
              applied_price_tier_name: null,
              pack_size: 1,
              stock_units_consumed: null,
              source: 'spec',
            })),
          },
        },
        {
          provide: CheckoutIdempotencyService,
          useValue: {
            begin: jest.fn().mockResolvedValue({ replay: false }),
            complete: jest.fn().mockResolvedValue(undefined),
            discard: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    (service as unknown as { logger: unknown }).logger = { warn } as any;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockOrderCreate() {
    prisma.orders.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 1, store_id: STORE_ID, order_number: data.order_number,
        grand_total: data.grand_total, currency: data.currency,
        state: data.state, order_items: [],
      }),
    );
  }

  const IVA19_ROWS = [
    { tax_rate_id: 1, name: 'IVA', rate: 0.19, tax_type: 'iva', is_inclusive: false },
  ];

  it('INC 8% inclusivo publicado a 59000 qty 1: gross de línea = 59000', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 59000 }) });
    mockOrderCreate();

    const result: any = await service.checkout({
      payment_method_id: 7,
      items: [{ product_id: 100, quantity: 1 }],
    } as any);

    const [line] = result.items;
    expect(line.unit_price_gross).toBe(59000);
    expect(line.total_price_gross).toBe(59000);
    // La base sigue siendo la del kernel (antes de impuesto).
    expect(line.total_price).toBeLessThan(59000);
    expect(result.subtotal_gross).toBe(59000);
  });

  it('IVA 19% no inclusivo sobre 10000 qty 2: gross de línea = 23800', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 10000 }) }, IVA19_ROWS);
    mockOrderCreate();

    const result: any = await service.checkout({
      payment_method_id: 7,
      items: [{ product_id: 100, quantity: 2 }],
    } as any);

    const [line] = result.items;
    expect(line.unit_price).toBe(10000);
    expect(line.total_price).toBe(20000);
    expect(line.unit_price_gross).toBe(11900);
    expect(line.total_price_gross).toBe(23800);
  });

  it('coherencia: suma gross + envío − descuento == total', async () => {
    await boot({
      100: buildProduct({ id: 100, price: 59000 }),
      101: buildProduct({ id: 101, price: 17 }),
    });
    mockOrderCreate();

    const result: any = await service.checkout({
      payment_method_id: 7,
      items: [
        { product_id: 100, quantity: 2 },
        { product_id: 101, quantity: 3 },
      ],
    } as any);

    const sum = result.items.reduce(
      (acc: number, i: any) => acc + i.total_price_gross,
      0,
    );
    expect(result.subtotal_gross).toBeCloseTo(sum, 2);
    expect(result.subtotal_gross).toBeCloseTo(result.subtotal + result.tax_amount, 2);
    expect(
      sum + result.shipping_cost - result.discount_amount,
    ).toBeCloseTo(result.total, 2);
  });

  it('WhatsApp: gross derivado de campos persistidos de order_items', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 59000 }) });
    prisma.orders.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 1, store_id: STORE_ID, order_number: data.order_number,
        grand_total: data.grand_total, currency: data.currency,
        state: data.state,
        order_items: data.order_items.create.map((c: any) => ({
          product_name: c.product_name, variant_sku: null,
          quantity: c.quantity, unit_price: c.unit_price,
          total_price: c.total_price, tax_amount_item: c.tax_amount_item,
          cancelled_at: null, cancellation_reason: null,
        })),
      }),
    );

    const result: any = await service.whatsappCheckout({
      items: [{ product_id: 100, quantity: 2 }],
    } as any);

    const [line] = result.items;
    expect(line.unit_price_gross).toBe(59000);
    expect(line.total_price_gross).toBe(118000);
    expect(result.subtotal_gross).toBe(118000);
    expect(
      result.subtotal_gross + result.shipping_cost - result.discount_amount,
    ).toBeCloseTo(Number(result.total), 2);
  });
});
