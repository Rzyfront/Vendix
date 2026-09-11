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
 * A.2 (CP-facturacion-impuesto-incluido-redondeo, F-009/F-061) — ARCHIVO NUEVO.
 *
 * Granularidad por bruto de LÍNEA en el checkout: UNA llamada al espejo por
 * línea, escala en Decimal, totales reusados del único resolve, y warn
 * estructurado con residuo antes de persistir. Cifras a mano:
 * - 3 × 1000 INC 8% ⇒ base 2777.78 / impuesto 222.22 / total 3000.00
 *   (por unidad daba 2777.79 contra 2777.78 del motor).
 * - 1 × 17 INC 8% ⇒ 15.74/1.25/16.99 + residuo 1 + warn (closest-below).
 *
 * `calculateProductTaxes` se mockea con FILAS (lo único que el núcleo lee de
 * `taxInfo`); base/total del mock van en 0 a propósito para probar que el
 * núcleo NO los re-resuelve por unidad (F-042) sino que resuelve la línea.
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

describe('CheckoutService — línea inclusiva por bruto de línea (A.2)', () => {
  let service: CheckoutService;
  let prisma: any;
  let warn: jest.Mock;

  const STORE_ID = 1;
  const USER_ID = 42;

  async function boot(products: Record<number, any>) {
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
        { provide: CartService, useValue: { clearCart: jest.fn().mockResolvedValue({ success: true }) } },
        {
          provide: TaxesService,
          useValue: {
            calculateProductTaxes: jest.fn().mockResolvedValue({
              total_rate: 0.08,
              total_tax_amount: 0,
              base: 0,
              total: 0,
              taxes: INC8_ROWS,
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

  it('3 × 1000 INC 8%: línea 2777.78/222.22/3000.00, sin warn', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 1000 }) });
    mockOrderCreate();

    const result: any = await service.checkout({
      payment_method_id: 7,
      items: [{ product_id: 100, quantity: 3 }],
    } as any);

    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    // Totales de LÍNEA exactos del espejo (nunca unidad×qty en floats).
    expect(orderArgs.subtotal_amount).toBe(2777.78);
    expect(orderArgs.tax_amount).toBe(222.22);
    expect(orderArgs.grand_total).toBe(3000);
    // Unitario derivado truncando en Decimal.
    const [item] = orderArgs.order_items.create;
    expect(item.unit_price).toBe(925.92);
    expect(item.total_price).toBe(2777.78);
    expect(item.tax_amount_item).toBe(74.07);
    expect(item.order_item_taxes.create[0]).toMatchObject({
      tax_rate_id: 68, tax_type: 'inc', is_inclusive: true,
    });
    // `tax_amount: t.amount * qty` en el create (patrón preexistente fuera del
    // hunk): 74.07×3 con polvo float — a centavos son 222.21.
    expect(item.order_item_taxes.create[0].tax_amount).toBeCloseTo(222.21, 10);
    expect(warn).not.toHaveBeenCalled();
    expect(result.total).toBe(3000);
  });

  it('1 × 17 INC 8%: closest-below 15.74/1.25/16.99 + warn con orden+línea+inputs', async () => {
    await boot({ 100: buildProduct({ id: 100, price: 17 }) });
    mockOrderCreate();

    const result: any = await service.checkout({
      payment_method_id: 7,
      items: [{ product_id: 100, quantity: 1 }],
    } as any);

    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    expect(orderArgs.subtotal_amount).toBe(15.74);
    expect(orderArgs.tax_amount).toBe(1.25);
    expect(orderArgs.grand_total).toBe(16.99);
    // Jamás overshoot: se cobra 16.99, no 17.
    expect(orderArgs.grand_total).toBeLessThanOrEqual(17);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      event: 'checkout.unclosed_residual_cents',
      line_index: 0,
      product_id: 100,
      quantity: 1,
      unit_gross: 17,
      line_gross: 17,
      residual_cents: 1,
    });
    expect(typeof warn.mock.calls[0][0].order_number).toBe('string');
    expect(result.total).toBe(16.99);
  });
});
