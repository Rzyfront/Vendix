import { BadRequestException, ConflictException } from '@nestjs/common';
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

/**
 * QUI-966 (S14) — the ecommerce checkout validates every booking BEFORE the
 * order exists, forwards the storefront booking fields, and never leaves an
 * order without its booking when the booking create fails afterwards.
 * Harness mirrors `checkout-gross-lines.spec.ts`.
 */
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

describe('CheckoutService — bookings (QUI-966 S14)', () => {
  let service: CheckoutService;
  let prisma: any;
  let warn: jest.Mock;
  let logError: jest.Mock;
  let reservations: Record<string, jest.Mock>;

  const STORE_ID = 1;
  const USER_ID = 42;

  async function boot(products: Record<number, any>, taxRows: any[] = INC8_ROWS) {
    warn = jest.fn();
    logError = jest.fn();
    reservations = {
      assertCheckoutBookingBookable: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(({ product_id }: any) => Promise.resolve({ id: 500 + product_id })),
      cancel: jest.fn().mockResolvedValue({}),
      compensateOrderForFailedBooking: jest.fn().mockResolvedValue(true),
    };

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
        { provide: ReservationsService, useValue: reservations },
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
    (service as unknown as { logger: unknown }).logger = {
      warn,
      log: jest.fn(),
      error: logError,
    } as any;
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

  const booking = (over: Record<string, unknown> = {}) => ({
    product_id: 100,
    date: '2026-11-05',
    start_time: '10:00',
    end_time: '11:00',
    provider_id: 5,
    provider_name: 'Ana',
    service_location_type: 'home',
    service_address_id: 44,
    service_address_label: 'Calle 1 # 2-3',
    ...over,
  });

  const checkoutWith = (bookings: unknown[]) =>
    service.checkout({
      payment_method_id: 7,
      items: [{ product_id: 100, quantity: 1 }],
      bookings,
    } as any);

  it.each([
    ['an invalid slot (400)', new BadRequestException('No se puede reservar en una fecha u hora que ya pasó')],
    ['a taken slot (409)', new ConflictException('El horario solicitado no esta disponible')],
  ])('rejects %s before creating any order, payment or booking', async (_l, err) => {
    await boot({ 100: buildProduct({ id: 100, price: 50000 }) });
    mockOrderCreate();
    reservations.assertCheckoutBookingBookable.mockRejectedValueOnce(err);

    await expect(checkoutWith([booking()])).rejects.toBe(err);

    expect(reservations.assertCheckoutBookingBookable).toHaveBeenCalledWith(
      STORE_ID,
      expect.objectContaining({ product_id: 100, date: '2026-11-05' }),
    );
    expect(prisma.orders.create).not.toHaveBeenCalled();
    expect(prisma.payments.create).not.toHaveBeenCalled();
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('pre-checks every booking and forwards provider and location fields (labels ignored)', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 50000 }) });
    mockOrderCreate();

    const result: any = await checkoutWith([booking()]);

    expect(result.order_id).toBe(1);
    expect(reservations.create).toHaveBeenCalledTimes(1);
    const arg = reservations.create.mock.calls[0][0];
    expect(arg).toMatchObject({
      customer_id: USER_ID,
      product_id: 100,
      date: '2026-11-05',
      start_time: '10:00',
      end_time: '11:00',
      provider_id: 5,
      service_location_type: 'home',
      service_address_id: 44,
      order_id: 1,
      skip_availability_check: false,
    });
    expect(arg).not.toHaveProperty('provider_name');
    expect(arg).not.toHaveProperty('service_address_label');
    expect(reservations.compensateOrderForFailedBooking).not.toHaveBeenCalled();
  });

  it('a booking that fails after the order (race) cancels the order and fails the checkout', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 50000 }) });
    mockOrderCreate();
    const race = new ConflictException('El horario solicitado no esta disponible');
    reservations.create
      .mockResolvedValueOnce({ id: 600 })
      .mockRejectedValueOnce(race);

    await expect(
      checkoutWith([booking(), booking({ start_time: '12:00', end_time: '13:00' })]),
    ).rejects.toBe(race);

    expect(reservations.assertCheckoutBookingBookable).toHaveBeenCalledTimes(2);
    expect(reservations.cancel).toHaveBeenCalledWith(600);
    expect(reservations.compensateOrderForFailedBooking).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Compensación'),
    );
    expect(logError).toHaveBeenCalled();
  });

  it('an unexpected (non-HTTP) booking failure also cancels the order and answers 409', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 50000 }) });
    mockOrderCreate();
    reservations.create.mockRejectedValueOnce(new Error('db down'));

    await expect(checkoutWith([booking()])).rejects.toBeInstanceOf(ConflictException);
    expect(reservations.compensateOrderForFailedBooking).toHaveBeenCalledWith(
      1,
      expect.any(String),
    );
  });
});
