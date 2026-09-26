import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckoutService } from './checkout.service';
import { CheckoutIdempotencyService } from './checkout-idempotency.service';
import { StorefrontPriceService } from '../shared/services/storefront-price.service';
import { ShippingDistanceService } from '../../store/shipping/services/shipping-distance.service';
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
import { VendixHttpException } from 'src/common/errors';

/**
 * Recálculo por distancia al confirmar (guest + producto físico).
 *
 * El costo de envío se deriva 100% en servidor con el mismo
 * `ShippingDistanceService` del cotizador y las coords de la dirección
 * final; el cliente nunca envía costos.
 */

const PRODUCT = {
  id: 100,
  name: 'Producto Físico',
  base_price: 10000,
  is_on_sale: false,
  sale_price: null,
  cost_price: 5000,
  product_type: 'physical',
  requires_shipping: true,
  track_inventory: false,
  is_sellable: true,
  product_tax_assignments: [],
};

const ORIGIN = { latitude: 4.71, longitude: -74.07 };
const BUYER = { latitude: 4.72, longitude: -74.06 };
const TIERS = [
  { from_km: 0, to_km: 10, price: 8000 },
  { from_km: 10, to_km: null, price: 12000 },
];

function buildRate(over: Record<string, any> = {}) {
  return {
    id: 55,
    shipping_zone_id: 9,
    shipping_method_id: 3,
    base_cost: 5000,
    distance_tiers: TIERS,
    shipping_method: {
      id: 3,
      type: 'own_fleet',
      distance_pricing_enabled: true,
      origin_latitude: ORIGIN.latitude,
      origin_longitude: ORIGIN.longitude,
    },
    shipping_zone: { id: 9, store_id: 1 },
    ...over,
  };
}

function buildDto(over: Record<string, any> = {}) {
  return {
    payment_method_id: 7,
    items: [{ product_id: PRODUCT.id, quantity: 1 }],
    guest_customer: { first_name: 'Invitado' },
    shipping_rate_id: 55,
    shipping_address: {
      address_line1: 'Calle 1 # 2-3',
      city: 'Bogotá',
      state_province: 'Cundinamarca',
      country_code: 'CO',
      postal_code: '110111',
      latitude: BUYER.latitude,
      longitude: BUYER.longitude,
    },
    ...over,
  } as any;
}

describe('CheckoutService - recálculo por distancia al confirmar', () => {
  let service: CheckoutService;
  let prisma: any;
  let storePrisma: any;
  let distance: any;

  const STORE_ID = 1;

  beforeEach(async () => {
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(undefined);

    distance = {
      resolveDistanceKm: jest.fn().mockResolvedValue(8.5),
    };

    prisma = {
      carts: { findFirst: jest.fn().mockResolvedValue(null) },
      products: {
        findUnique: jest.fn().mockResolvedValue({ ...PRODUCT }),
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
      orders: {
        create: jest.fn(({ data }: any) =>
          Promise.resolve({
            id: 1,
            store_id: STORE_ID,
            order_number: data.order_number,
            grand_total: data.grand_total,
            currency: data.currency,
            state: data.state,
            order_items: [],
          }),
        ),
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
      bank_accounts: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    storePrisma = {
      shipping_methods: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
      orders: { count: jest.fn().mockResolvedValue(0) },
      shipping_rates: { findFirst: jest.fn().mockResolvedValue(buildRate()) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(null) },
      dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_data_requests: { update: jest.fn() },
      store_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      organizations: { findUnique: jest.fn().mockResolvedValue(null) },
      payments: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      store_payment_methods: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bank_accounts: { findMany: jest.fn().mockResolvedValue([]) },
      domain_settings: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: storePrisma },
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
              total_rate: 0,
              total_tax_amount: 0,
              taxes: [],
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
          useValue: {
            resolvePrice: jest.fn(({ product }: any) => ({
              unitPrice: Number(product.base_price),
              unitPriceWithTax: Number(product.base_price),
              unitBasePrice: Number(product.base_price),
            })),
          },
        },
        { provide: WompiClientFactory, useValue: { getClient: jest.fn() } },
        { provide: WompiProcessor, useValue: {} },
        { provide: PaymentEncryptionService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        {
          provide: PaymentGatewayService,
          useValue: {
            resolveAndValidateBankAccount: jest.fn(async (id: number) => ({
              id,
              name: null,
              bank_name: 'mock',
              account_number: '000',
              currency: 'COP',
            })),
          },
        },
        { provide: ReservationsService, useValue: { create: jest.fn() } },
        {
          provide: InvoiceDataRequestsService,
          useValue: {
            createRequest: jest
              .fn()
              .mockResolvedValue({ id: 1, token: 'tok-guest' }),
          },
        },
        {
          provide: InvoicingService,
          useValue: {
            createFromOrder: jest.fn(),
            getEcommerceInvoicingSettings: jest
              .fn()
              .mockResolvedValue({ auto_emit: true }),
          },
        },
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
        {
          provide: S3Service,
          useValue: {
            signUrl: jest.fn(),
            uploadFile: jest.fn(),
            getPresignedUrl: jest.fn().mockResolvedValue(null),
          },
        },
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
        {
          provide: PromotionEngineService,
          useValue: {
            quoteDiscounts: jest.fn().mockResolvedValue({
              subtotal: 0,
              total_discount: 0,
              promotional_subtotal: 0,
              applied_promotions: [],
              items: [],
              order_promotions_snapshot: [],
            }),
            applyPromotion: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CouponsService,
          useValue: {
            validate: jest.fn(),
            registerUse: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FiscalInvoiceThresholdService,
          useValue: { assertInvoiceNotRequired: jest.fn(), evaluate: jest.fn() },
        },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: {
            getBlockedProductIds: jest.fn().mockResolvedValue(new Set<number>()),
          },
        },
        {
          provide: StorefrontPriceService,
          useValue: {
            resolveLine: jest.fn(({ product }: any) => {
              const unitPrice = Number(product?.base_price ?? 0);
              return {
                net_unit_price: unitPrice,
                gross_unit_price: unitPrice,
                compare_at_price: null,
                tax_rate: 0,
                applied_price_tier_id: null,
                applied_price_tier_name: null,
                pack_size: 1,
                stock_units_consumed: null,
                source: 'spec',
              };
            }),
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
        { provide: ShippingDistanceService, useValue: distance },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cobra el precio de la escala (8.5 km → tramo 8000)', async () => {
    const result: any = await service.checkout(buildDto());

    expect(distance.resolveDistanceKm).toHaveBeenCalledWith(ORIGIN, BUYER);
    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    expect(orderArgs.shipping_cost).toBe(8000);
    expect(orderArgs.shipping_rate_id).toBe(55);
    expect(orderArgs.grand_total).toBe(18000);
    expect(result.total).toBe(18000);
  });

  it('sin coords en la dirección cobra precio de zona (5000)', async () => {
    const dto = buildDto();
    delete dto.shipping_address.latitude;
    delete dto.shipping_address.longitude;

    const result: any = await service.checkout(dto);

    expect(distance.resolveDistanceKm).not.toHaveBeenCalled();
    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    expect(orderArgs.shipping_cost).toBe(5000);
    expect(result.total).toBe(15000);
  });

  it('motor caído cobra precio de zona sin romper el checkout', async () => {
    distance.resolveDistanceKm.mockRejectedValue(new Error('down'));

    const result: any = await service.checkout(buildDto());

    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    expect(orderArgs.shipping_cost).toBe(5000);
    expect(result.total).toBe(15000);
  });

  it('método sin distancia activa cobra zona y no rutea', async () => {
    storePrisma.shipping_rates.findFirst.mockResolvedValue(
      buildRate({
        shipping_method: {
          id: 3,
          type: 'own_fleet',
          distance_pricing_enabled: false,
          origin_latitude: null,
          origin_longitude: null,
        },
      }),
    );

    const result: any = await service.checkout(buildDto());

    expect(distance.resolveDistanceKm).not.toHaveBeenCalled();
    expect(prisma.orders.create.mock.calls[0][0].data.shipping_cost).toBe(5000);
    expect(result.total).toBe(15000);
  });

  it('tarifa sin escala cobra zona y no rutea', async () => {
    storePrisma.shipping_rates.findFirst.mockResolvedValue(
      buildRate({ distance_tiers: null }),
    );

    await service.checkout(buildDto());

    expect(distance.resolveDistanceKm).not.toHaveBeenCalled();
    expect(prisma.orders.create.mock.calls[0][0].data.shipping_cost).toBe(5000);
  });

  it('tarifa free con escala cobra 0 al confirmar y no rutea', async () => {
    storePrisma.shipping_rates.findFirst.mockResolvedValue(
      buildRate({ type: 'free', base_cost: 5000 }),
    );

    const result: any = await service.checkout(buildDto());

    expect(distance.resolveDistanceKm).not.toHaveBeenCalled();
    const orderArgs = prisma.orders.create.mock.calls[0][0].data;
    expect(orderArgs.shipping_cost).toBe(0);
    expect(orderArgs.grand_total).toBe(10000);
    expect(result.total).toBe(10000);
  });

  it('distancia fuera de todos los rangos rechaza con 400', async () => {
    distance.resolveDistanceKm.mockResolvedValue(50);
    storePrisma.shipping_rates.findFirst.mockResolvedValue(
      buildRate({
        distance_tiers: [
          { from_km: 0, to_km: 10, price: 8000 },
          { from_km: 10, to_km: 20, price: 12000 },
        ],
      }),
    );

    await expect(service.checkout(buildDto())).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.orders.create).not.toHaveBeenCalled();
  });
});
