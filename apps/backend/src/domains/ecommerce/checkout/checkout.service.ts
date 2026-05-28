import { Injectable } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CartService } from '../cart/cart.service';
import { TaxesService } from '../../store/taxes/taxes.service';
import { CheckoutDto } from './dto/checkout.dto';
import { WhatsappCheckoutDto } from './dto/whatsapp-checkout.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { payment_processing_mode_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../../store/settings/settings.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../../store/inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../../store/inventory/shared/services/stock-validator.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { WompiClientFactory } from '../../store/payments/processors/wompi/wompi.factory';
import { WompiEnvironment } from '../../store/payments/processors/wompi/wompi.types';
import { WompiProcessor } from '../../store/payments/processors/wompi/wompi.processor';
import { PaymentEncryptionService } from '../../store/payments/services/payment-encryption.service';
import { WebhookHandlerService } from '../../store/payments/services/webhook-handler.service';
import * as crypto from 'crypto';
import { ReservationsService } from '../../store/reservations/reservations.service';
import { order_channel_enum } from '@prisma/client';
import { deriveDeliveryType } from '../../store/shipping/shipping-derivation.util';
import { InvoiceDataRequestsService } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.service';
import { InvoicingService } from '../../store/invoicing/invoicing.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { CustomersService } from '../../store/customers/customers.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../../store/coupons/coupons.service';
import { CouponAppliesTo } from '../../store/coupons/dto';
import { PromotionQuoteResult } from '../../store/promotions/dto/promotion-quote.interface';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly store_prisma: StorePrismaService,
    private readonly cart_service: CartService,
    private readonly taxes_service: TaxesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly stockValidatorService: StockValidatorService,
    private readonly priceResolverService: PriceResolverService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly wompiProcessor: WompiProcessor,
    private readonly paymentEncryption: PaymentEncryptionService,
    private readonly reservationsService: ReservationsService,
    private readonly webhookHandler: WebhookHandlerService,
    private readonly invoiceDataRequestsService: InvoiceDataRequestsService,
    private readonly invoicingService: InvoicingService,
    private readonly operatingScopeService: OperatingScopeService,
    private readonly fiscalStatusService: FiscalStatusService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    private readonly customersService: CustomersService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly couponsService: CouponsService,
  ) {}

  /**
   * MIME types accepted as payment receipts attached to checkout. Aligned with
   * the customer-facing copy in the modal (image or PDF).
   */
  private static readonly RECEIPT_ALLOWED_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  /**
   * Returns whether the current ecommerce store has invoicing fiscal status
   * set to ACTIVE. Used by guest checkout to decide if the optional invoice
   * data section should be shown.
   *
   * Reads `store_settings.settings.fiscal_status.invoicing.state` for the
   * store resolved from the domain context. Requires store context (set by
   * DomainResolverMiddleware) but does not require authentication.
   */
  async getInvoicingEligibility(): Promise<{ invoicing_enabled: boolean }> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const state = await this.fiscalStatusService.getStoreInvoicingState(
      store_id,
    );
    return { invoicing_enabled: state === 'ACTIVE' };
  }

  async getPaymentMethods(shippingMethodType?: string) {
    // Determine allowed processing modes based on shipping method type
    // - pickup: DIRECT (cash at store) + ONLINE (online payments)
    // - delivery/carrier/own_fleet: ONLINE + ON_DELIVERY (pay on delivery)
    let allowedModes: payment_processing_mode_enum[];

    if (shippingMethodType === 'pickup') {
      allowedModes = [
        payment_processing_mode_enum.DIRECT,
        payment_processing_mode_enum.ONLINE,
      ];
    } else if (shippingMethodType) {
      // For delivery methods (own_fleet, carrier, custom, third_party_provider)
      allowedModes = [
        payment_processing_mode_enum.ONLINE,
        payment_processing_mode_enum.ON_DELIVERY,
      ];
    } else {
      // No shipping type specified - return all methods (backwards compatibility)
      allowedModes = [
        payment_processing_mode_enum.DIRECT,
        payment_processing_mode_enum.ONLINE,
        payment_processing_mode_enum.ON_DELIVERY,
      ];
    }

    // store_id se aplica automáticamente por EcommercePrismaService
    const methods = await this.prisma.store_payment_methods.findMany({
      where: {
        state: 'enabled',
        system_payment_method: {
          processing_mode: { in: allowedModes },
        },
      },
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });

    return methods.map((m) => {
      const base: Record<string, any> = {
        id: m.id,
        name: m.display_name || m.system_payment_method.display_name,
        type: m.system_payment_method.type,
        provider: m.system_payment_method.provider,
        processing_mode: m.system_payment_method.processing_mode,
        logo_url: m.system_payment_method.logo_url,
        min_amount: m.min_amount,
        max_amount: m.max_amount,
      };

      const instructions = this.buildPaymentInstructions(
        m.system_payment_method.type,
        m.custom_config,
      );
      if (instructions) {
        base.payment_instructions = instructions;
      }

      return base;
    });
  }

  /**
   * Returns a whitelisted subset of `custom_config` to expose publicly for
   * payment methods whose `system_payment_method.type` is `bank_transfer` or
   * `voucher`. Returns `null` when there is nothing to expose so the caller
   * can omit the field entirely (we never return an empty `{}`).
   *
   * Whitelists:
   *  - bank_transfer: bank_name, account_holder, account_number, account_type, instructions
   *  - voucher:       voucher_instructions, redemption_phone, notes
   */
  private buildPaymentInstructions(
    type: string,
    customConfig: unknown,
  ): Record<string, unknown> | null {
    if (type !== 'bank_transfer' && type !== 'voucher') return null;
    if (!customConfig || typeof customConfig !== 'object') return null;

    const config = customConfig as Record<string, unknown>;
    const whitelist: string[] =
      type === 'bank_transfer'
        ? [
            'bank_name',
            'account_holder',
            'account_number',
            'account_type',
            'instructions',
          ]
        : ['voucher_instructions', 'redemption_phone', 'notes'];

    const exposed: Record<string, unknown> = {};
    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        const value = config[key];
        if (value !== null && value !== undefined && value !== '') {
          exposed[key] = value;
        }
      }
    }

    return Object.keys(exposed).length > 0 ? exposed : null;
  }

  private async getCheckoutSettings(): Promise<{
    require_registration: boolean;
  }> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const storeSettings = await this.store_prisma.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const checkout =
      (storeSettings?.settings as any)?.ecommerce?.checkout || {};

    return {
      require_registration: !!checkout.require_registration,
    };
  }

  private async assertGuestCheckoutAllowed(): Promise<void> {
    if (RequestContextService.getUserId()) return;

    const checkoutSettings = await this.getCheckoutSettings();
    if (checkoutSettings.require_registration) {
      throw new BadRequestException(
        'Debes iniciar sesión o registrarte para completar esta compra',
      );
    }
  }

  private normalizeGuestCustomer(customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
  }) {
    if (!customer) return null;

    const normalized = {
      first_name: customer.first_name?.trim() || null,
      last_name: customer.last_name?.trim() || null,
      email: customer.email?.trim() || null,
      phone: customer.phone?.trim() || null,
      document_type: customer.document_type?.trim() || null,
      document_number: customer.document_number?.trim() || null,
    };

    return Object.values(normalized).some(Boolean) ? normalized : null;
  }

  private async createInvoiceIfConfigured(
    orderId: number,
  ): Promise<number | null> {
    const store_id = RequestContextService.getStoreId();
    if (store_id) {
      const state =
        await this.fiscalStatusService.getStoreInvoicingState(store_id);
      if (state !== 'ACTIVE') return null;
    }

    const existing = await this.store_prisma.invoices.findFirst({
      where: { order_id: orderId, invoice_type: 'sales_invoice' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const now = new Date();
    const [resolution, dianConfig] = await Promise.all([
      this.store_prisma.invoice_resolutions.findFirst({
        where: {
          is_active: true,
          valid_from: { lte: now },
          valid_to: { gte: now },
        },
        select: { id: true },
      }),
      this.store_prisma.dian_configurations.findFirst({
        where: { enablement_status: { in: ['testing', 'enabled'] } },
        select: { id: true },
      }),
    ]);

    if (!resolution || !dianConfig) return null;

    try {
      const invoice = await this.invoicingService.createFromOrder(orderId);
      return invoice.id;
    } catch (error) {
      this.logger.warn(
        `Invoice creation skipped for ecommerce order ${orderId}: ${error.message}`,
      );
      return null;
    }
  }

  private async createGuestOrderArtifacts(
    orderId: number,
    guestCustomer?: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
      document_type?: string | null;
      document_number?: string | null;
    } | null,
  ): Promise<{ invoice_data_token: string; invoice_id: number | null } | null> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) return null;

    const request = await this.invoiceDataRequestsService.createRequest(
      store_id,
      orderId,
      undefined,
      guestCustomer,
    );
    const invoice_id = await this.createInvoiceIfConfigured(orderId);

    if (invoice_id) {
      await this.store_prisma.invoice_data_requests.update({
        where: { id: request.id },
        data: { invoice_id, updated_at: new Date() },
      });
    }

    return {
      invoice_data_token: request.token,
      invoice_id,
    };
  }

  private async assertOrderAccess(
    orderId: number,
    customerId: number | null,
    publicOrderToken?: string,
  ): Promise<void> {
    const userId = RequestContextService.getUserId();
    const requiresPublicToken = !userId || customerId === null;

    if (requiresPublicToken) {
      if (!publicOrderToken) {
        throw new BadRequestException('Token público de orden requerido');
      }

      const publicOrder =
        await this.store_prisma.invoice_data_requests.findFirst({
          where: { token: publicOrderToken, order_id: orderId },
          select: { id: true },
        });

      if (!publicOrder) {
        throw new BadRequestException('Token público de orden inválido');
      }
      return;
    }

    if (customerId !== userId) {
      throw new NotFoundException('No se encontró la orden');
    }
  }

  /**
   * Round money to 2 decimals (HALF_UP). Centralized so quote, coupon and
   * order totals don't drift due to floating arithmetic.
   */
  private roundMoney(value: number): number {
    return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  }

  /**
   * Fetch the categories every product in `productIds` belongs to. Returned
   * as a Map<productId, number[]> so the promotion engine and coupon validator
   * can match category-scoped rules without extra round-trips.
   *
   * Uses the store-scoped client because `product_categories` is multi-tenant
   * by transitive `products.store_id` filter.
   */
  private async resolveProductCategories(
    productIds: number[],
  ): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (productIds.length === 0) return map;

    const rows = await this.store_prisma.product_categories.findMany({
      where: { product_id: { in: productIds } },
      select: { product_id: true, category_id: true },
    });

    for (const row of rows) {
      const existing = map.get(row.product_id) ?? [];
      existing.push(row.category_id);
      map.set(row.product_id, existing);
    }
    return map;
  }

  /**
   * Run the promotion engine for the resolved cart items and optionally
   * validate the coupon supplied in the checkout payload. Returns subtotal,
   * promotion + coupon discounts, totals, and persistence-ready snapshots.
   *
   * Discount base is the items SUBTOTAL (excludes shipping and taxes); taxes
   * and shipping are added back to compute the grand total in the caller.
   */
  private async resolveCheckoutDiscounts(params: {
    items: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity: number;
      net_price: number;
    }>;
    customerId: number | null;
    couponCode?: string | null;
  }): Promise<{
    quote: PromotionQuoteResult;
    coupon: {
      coupon_id: number;
      discount_amount: number;
    } | null;
    promotion_discount: number;
    coupon_discount: number;
    total_discount: number;
  }> {
    const items = params.items;
    if (items.length === 0) {
      return {
        quote: {
          subtotal: 0,
          total_discount: 0,
          promotional_subtotal: 0,
          applied_promotions: [],
          items: [],
          order_promotions_snapshot: [],
        },
        coupon: null,
        promotion_discount: 0,
        coupon_discount: 0,
        total_discount: 0,
      };
    }

    const productIds = Array.from(new Set(items.map((i) => i.product_id)));
    const categoryMap = await this.resolveProductCategories(productIds);

    const quote = await this.promotionEngine.quoteDiscounts({
      items: items.map((item, index) => ({
        line_id: index,
        product_id: item.product_id,
        variant_id: item.product_variant_id,
        category_ids: categoryMap.get(item.product_id) ?? [],
        unit_price: this.roundMoney(item.net_price),
        quantity: item.quantity,
      })),
      customer_id: params.customerId,
    });

    const couponCode = params.couponCode?.trim();
    let coupon: { coupon_id: number; discount_amount: number } | null = null;

    if (couponCode) {
      // Discount base for the coupon is the post-promotion subtotal so we
      // never refund money the customer didn't actually pay. We pass per-line
      // totals so SPECIFIC_PRODUCTS / SPECIFIC_CATEGORIES coupons can
      // recompute their applicable subtotal correctly.
      const couponItems = quote.items.map((it) => ({
        product_id: it.product_id,
        category_ids: categoryMap.get(it.product_id) ?? [],
        line_total: this.roundMoney(it.final_line_total),
      }));

      const validation = await this.couponsService.validate({
        code: couponCode,
        customer_id: params.customerId ?? undefined,
        cart_subtotal: this.roundMoney(quote.promotional_subtotal),
        product_ids: productIds,
        category_ids: Array.from(
          new Set(
            productIds.flatMap((id) => categoryMap.get(id) ?? []),
          ),
        ),
        items: couponItems,
      });

      coupon = {
        coupon_id: validation.coupon_id,
        discount_amount: this.roundMoney(validation.discount_amount),
      };
    }

    const promotion_discount = this.roundMoney(quote.total_discount);
    const coupon_discount = this.roundMoney(coupon?.discount_amount ?? 0);
    const total_discount = this.roundMoney(promotion_discount + coupon_discount);

    return {
      quote,
      coupon,
      promotion_discount,
      coupon_discount,
      total_discount,
    };
  }

  /**
   * Persist `order_promotions` + `coupon_uses` after the ecommerce order
   * has been created. Each promotion is wrapped in its own try/catch so a
   * race on usage limits doesn't break the checkout (the order is already
   * committed; we'd rather emit a warning than 500 the customer).
   */
  private async persistPromotionsAndCoupon(params: {
    orderId: number;
    customerId: number | null;
    quote: PromotionQuoteResult;
    coupon: { coupon_id: number; discount_amount: number } | null;
  }): Promise<void> {
    for (const snapshot of params.quote.order_promotions_snapshot) {
      try {
        await this.promotionEngine.applyPromotion(
          params.orderId,
          snapshot.promotion_id,
          snapshot.discount_amount,
          params.customerId,
        );
      } catch (err) {
        this.logger.warn(
          `Promotion ${snapshot.promotion_id} could not be applied to order ${params.orderId}: ${(err as Error).message}`,
        );
      }
    }

    if (params.coupon && params.coupon.discount_amount > 0) {
      try {
        await this.couponsService.registerUse(
          params.coupon.coupon_id,
          params.orderId,
          params.customerId,
          params.coupon.discount_amount,
        );
      } catch (err) {
        this.logger.warn(
          `Coupon ${params.coupon.coupon_id} could not be registered for order ${params.orderId}: ${(err as Error).message}`,
        );
      }
    }
  }

  async checkout(dto: CheckoutDto, file?: Express.Multer.File) {
    await this.assertGuestCheckoutAllowed();

    const user_id = RequestContextService.getUserId();
    const is_guest = !user_id;
    const guest_customer = this.normalizeGuestCustomer(dto.guest_customer);

    const store_id_ctx = RequestContextService.getStoreId();
    let resolved_customer_id: number | null = user_id ?? null;
    if (is_guest && guest_customer && store_id_ctx) {
      const resolved =
        await this.customersService.resolveGuestCustomerForCheckout(
          store_id_ctx,
          guest_customer,
        );
      resolved_customer_id = resolved?.customer_id ?? null;
    }

    if (is_guest && dto.bookings?.length) {
      throw new BadRequestException(
        'Debes iniciar sesión para reservar servicios con horario',
      );
    }

    // Guest checkout must never read store-scoped backend carts because there
    // is no customer_id filter without auth. Guests use DTO items from localStorage.
    const cart = is_guest
      ? null
      : await this.prisma.carts.findFirst({
          include: {
            cart_items: {
              include: {
                product: true,
                product_variant: true,
              },
            },
          },
        });

    // Fallback: if backend cart is empty but frontend sent items, build from DTO
    // This handles the case where localStorage cart was never synced to backend
    let cart_items = cart?.cart_items || [];

    if (
      (is_guest || cart_items.length === 0) &&
      dto.items &&
      dto.items.length > 0
    ) {
      cart_items = await Promise.all(
        dto.items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            throw new VendixHttpException(ErrorCodes.ECOM_PRODUCT_001);
          }

          let product_variant: any = null;
          if (item.product_variant_id) {
            product_variant = await this.prisma.product_variants.findUnique({
              where: { id: item.product_variant_id },
            });
            if (
              !product_variant ||
              product_variant.product_id !== item.product_id
            ) {
              throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
            }
          }

          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            quantity: item.quantity,
            product,
            product_variant,
          } as any;
        }),
      );
    }

    if (cart_items.length === 0) {
      throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
    }

    const cart_currency =
      cart?.currency || (await this.settingsService.getStoreCurrency());

    // store_id se aplica automáticamente
    const payment_method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: dto.payment_method_id,
        state: 'enabled',
      },
      include: { system_payment_method: true },
    });

    if (!payment_method) {
      throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_002);
    }

    for (const item of cart_items) {
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
      }

      const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
        item.product,
        item.product_variant ?? undefined,
      );

      if (shouldTrack) {
        const availability =
          await this.stockValidatorService.validateAvailability(
            item.product_id,
            item.product_variant_id ?? undefined,
            item.quantity,
          );

        if (!availability.isAvailable) {
          const productName = item.product.name;
          const variantInfo = item.product_variant?.name
            ? ` (${item.product_variant.name})`
            : '';
          throw new VendixHttpException(
            ErrorCodes.ECOM_CART_003,
            `Insufficient stock for ${productName}${variantInfo}: requested ${item.quantity}, available ${availability.available}`,
          );
        }
      }
    }

    const hasPhysicalItems = cart_items.some((item: any) => {
      const product = item.product;
      if (!product) return true;
      if (product.product_type === 'service') return false;
      if (product.requires_shipping === false) return false;
      return true;
    });

    if (hasPhysicalItems && !dto.shipping_method_id && !dto.shipping_rate_id) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_001);
    }

    let shipping_address_id: number | null | undefined =
      dto.shipping_address_id;
    let shipping_address_snapshot: any = null;

    if (is_guest && shipping_address_id) {
      throw new BadRequestException(
        'Los invitados deben enviar la dirección de envío en el checkout',
      );
    }

    if (dto.shipping_address && is_guest) {
      shipping_address_id = null;
      shipping_address_snapshot = dto.shipping_address;
    } else if (dto.shipping_address && !shipping_address_id) {
      // user_id se inyecta automáticamente
      const new_address = await this.prisma.addresses.create({
        data: {
          address_line1: dto.shipping_address.address_line1,
          address_line2: dto.shipping_address.address_line2,
          city: dto.shipping_address.city,
          state_province: dto.shipping_address.state_province,
          country_code: dto.shipping_address.country_code,
          postal_code: dto.shipping_address.postal_code,
          phone_number: dto.shipping_address.phone_number,
          type: 'shipping',
        },
      });
      shipping_address_id = new_address.id;
      shipping_address_snapshot = dto.shipping_address;
    } else if (shipping_address_id) {
      const address = await this.prisma.addresses.findUnique({
        where: { id: shipping_address_id },
      });
      if (address) {
        shipping_address_snapshot = {
          address_line1: address.address_line1,
          address_line2: address.address_line2,
          city: address.city,
          state_province: address.state_province,
          country_code: address.country_code,
          postal_code: address.postal_code,
          phone_number: address.phone_number,
        };
      }
    }

    // Validar y calcular shipping
    const store_id = RequestContextService.getStoreId();
    let shipping_cost = 0;
    let shipping_method_id: number | null = null;
    let shipping_rate_id: number | null = null;
    let delivery_type:
      | 'pickup'
      | 'home_delivery'
      | 'direct_delivery'
      | 'other' = 'direct_delivery';

    if (dto.shipping_rate_id) {
      const rate = await this.store_prisma.shipping_rates.findFirst({
        where: {
          id: dto.shipping_rate_id,
          is_active: true,
        },
        include: {
          shipping_method: true,
          shipping_zone: true,
        },
      });

      if (!rate) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
      }

      // Verificar que la zona pertenece a la tienda
      if (rate.shipping_zone.store_id !== store_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
      }

      shipping_cost = Number(rate.base_cost);
      shipping_method_id = rate.shipping_method_id;
      shipping_rate_id = rate.id;

      // Derive delivery_type from shipping method type
      const methodType = rate.shipping_method.type;
      if (methodType === 'pickup') {
        delivery_type = 'pickup';
      } else {
        delivery_type = 'home_delivery';
      }
    } else if (dto.shipping_method_id) {
      // Fallback: si solo viene shipping_method_id sin rate
      const method = await this.store_prisma.shipping_methods.findFirst({
        where: {
          id: dto.shipping_method_id,
          store_id: store_id,
          is_active: true,
        },
      });

      if (!method) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
      }

      shipping_method_id = method.id;
      // En este caso, shipping_cost queda en 0 o se debería recalcular
    }

    if (
      hasPhysicalItems &&
      delivery_type !== 'pickup' &&
      !shipping_address_id &&
      !shipping_address_snapshot
    ) {
      throw new BadRequestException('La dirección de envío es requerida');
    }

    const order_number = await this.generateOrderNumber();

    const itemsWithTaxes = await Promise.all(
      cart_items.map(async (item) => {
        const productWithTaxes = await this.prisma.products.findUnique({
          where: { id: item.product_id },
          include: {
            product_tax_assignments: {
              include: {
                tax_categories: {
                  include: {
                    tax_rates: true,
                  },
                },
              },
            },
          },
        });

        const priceResult = this.priceResolverService.resolvePrice({
          product: {
            base_price: Number(productWithTaxes.base_price),
            is_on_sale: productWithTaxes.is_on_sale,
            sale_price:
              productWithTaxes.sale_price != null
                ? Number(productWithTaxes.sale_price)
                : null,
            track_inventory: productWithTaxes.track_inventory,
          },
          variant: item.product_variant
            ? {
                price_override:
                  item.product_variant.price_override != null
                    ? Number(item.product_variant.price_override)
                    : null,
                is_on_sale: item.product_variant.is_on_sale,
                sale_price:
                  item.product_variant.sale_price != null
                    ? Number(item.product_variant.sale_price)
                    : null,
                track_inventory_override:
                  item.product_variant.track_inventory_override,
              }
            : undefined,
        });

        const netPrice = priceResult.unitPrice;

        const taxInfo = await this.taxes_service.calculateProductTaxes(
          item.product_id,
          netPrice,
        );

        const cost_price =
          item.product_variant?.cost_price != null
            ? Number(item.product_variant.cost_price)
            : productWithTaxes.cost_price != null
              ? Number(productWithTaxes.cost_price)
              : null;

        return {
          ...item,
          net_price: netPrice,
          cost_price,
          tax_rate: taxInfo.total_rate,
          tax_amount_item: taxInfo.total_tax_amount,
          total_tax: taxInfo.total_tax_amount * item.quantity,
          total_net: netPrice * item.quantity,
          item_taxes: taxInfo.taxes,
        };
      }),
    );

    const subtotal = this.roundMoney(
      itemsWithTaxes.reduce((sum, item) => sum + item.total_net, 0),
    );
    const total_tax = this.roundMoney(
      itemsWithTaxes.reduce((sum, item) => sum + item.total_tax, 0),
    );

    // Recompute promotional + coupon discounts on the backend. Frontend
    // only sends the coupon code (if any); totals here are authoritative.
    const discountResult = await this.resolveCheckoutDiscounts({
      items: itemsWithTaxes.map((item) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? null,
        quantity: item.quantity,
        net_price: item.net_price,
      })),
      customerId: resolved_customer_id,
      couponCode: dto.coupon_code,
    });

    // Discount base is the products subtotal BEFORE shipping. We add taxes
    // and shipping AFTER subtracting the discount, mirroring the POS flow.
    // Clamp grand_total at >= 0 in case a fixed coupon exceeds subtotal.
    const grand_total = this.roundMoney(
      Math.max(
        0,
        subtotal + total_tax - discountResult.total_discount + shipping_cost,
      ),
    );

    // store_id y customer_id (user_id) se inyectan automáticamente
    const order = await this.prisma.orders.create({
      data: {
        order_number,
        customer_id: resolved_customer_id,
        channel: 'ecommerce', // Ecommerce orders are assigned 'ecommerce' channel
        currency: cart_currency,
        subtotal_amount: subtotal,
        tax_amount: total_tax,
        discount_amount: discountResult.total_discount,
        shipping_cost: shipping_cost,
        shipping_method_id: shipping_method_id,
        shipping_rate_id: shipping_rate_id,
        delivery_type: delivery_type,
        grand_total: grand_total,
        shipping_address_id,
        shipping_address_snapshot,
        state: 'pending_payment',
        internal_notes: dto.notes,
        placed_at: new Date(),
        order_items: {
          create: itemsWithTaxes.map((item) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product.name,
            variant_sku: item.product_variant?.sku,
            variant_attributes: item.product_variant?.attributes
              ? JSON.stringify(item.product_variant.attributes)
              : null,
            quantity: item.quantity,
            unit_price: item.net_price,
            total_price: item.total_net,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            cost_price: item.cost_price,
            order_item_taxes: {
              create: item.item_taxes.map((t) => ({
                tax_rate_id: t.tax_rate_id,
                tax_name: t.name,
                tax_rate: t.rate,
                tax_amount: t.amount * item.quantity,
              })),
            },
          })),
        },
      },
      include: {
        order_items: true,
      },
    });

    // Persist applied promotions + coupon usage. We do this OUTSIDE the order
    // create call so the snapshot/coupon flow doesn't tangle with order_items
    // nested writes — they live under different scoped clients (store vs
    // ecommerce) and need transparent error handling per promo.
    await this.persistPromotionsAndCoupon({
      orderId: order.id,
      customerId: resolved_customer_id,
      quote: discountResult.quote,
      coupon: discountResult.coupon,
    });

    // Emit order.created event for notifications
    this.eventEmitter.emit('order.created', {
      store_id: order.store_id,
      order_id: order.id,
      order_number: order.order_number,
      grand_total: Number(order.grand_total),
      currency: order.currency,
    });

    // Upload payment receipt to S3 if the selected method is bank_transfer
    // or voucher and the customer attached a file. For any other method we
    // ignore the file silently (don't upload, don't fail) so generic
    // checkout requests don't break if the frontend keeps sending one.
    //
    // NOTE: If `payments.create` (below) fails AFTER a successful upload,
    // the S3 object will be orphaned. We intentionally don't implement
    // cleanup here — orphaned receipts are cheap to bulk-purge offline and
    // adding rollback would complicate the happy path. Tracked as a
    // follow-up (see plan webpage-annotations-jiggly-pond.md §1.3).
    let receipt_s3_key: string | null = null;
    let receipt_uploaded_at: Date | null = null;
    const receiptEligibleMethodType =
      payment_method.system_payment_method.type === 'bank_transfer' ||
      payment_method.system_payment_method.type === 'voucher';

    if (file && receiptEligibleMethodType) {
      receipt_s3_key = await this.uploadCheckoutReceipt(file);
      receipt_uploaded_at = new Date();
    }

    // store_id y customer_id se inyectan automáticamente
    await this.prisma.payments.create({
      data: {
        order_id: order.id,
        amount: grand_total,
        currency: cart_currency,
        state: 'pending',
        store_payment_method_id: dto.payment_method_id,
        receipt_s3_key,
        receipt_uploaded_at,
      },
    });

    for (const item of cart_items) {
      if (!this.shouldReserveStock(item)) continue;
      try {
        // P3.4: Resolves to central warehouse when org scope = ORGANIZATION,
        // otherwise falls back to the legacy per-product default location.
        const location_id = await this.resolveReservationLocationId({
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
        });
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          order.id,
          undefined,
          false, // Already validated stock above
        );
      } catch (error) {
        this.logger.warn(
          `Stock reservation failed for product ${item.product_id}: ${error.message}`,
        );
      }
    }

    // Create bookings for bookable services
    if (dto.bookings && dto.bookings.length > 0) {
      const user_id = RequestContextService.getUserId();
      for (const booking of dto.bookings) {
        try {
          await this.reservationsService.create({
            customer_id: user_id!,
            product_id: booking.product_id,
            product_variant_id: booking.product_variant_id,
            date: booking.date,
            start_time: booking.start_time,
            end_time: booking.end_time,
            channel: order_channel_enum.ecommerce,
            order_id: order.id,
            skip_availability_check: false,
          });
          this.logger.log(
            `Booking created for product ${booking.product_id} linked to order ${order.id}`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to create booking for product ${booking.product_id}: ${error.message}`,
          );
          // Don't fail the entire checkout if a booking fails
          // The order is already created; booking can be retried manually
        }
      }
    }

    const invoice_id = is_guest
      ? null
      : await this.createInvoiceIfConfigured(order.id);
    const guestArtifacts = is_guest
      ? await this.createGuestOrderArtifacts(order.id, guest_customer)
      : null;

    if (!is_guest) {
      // store_id y user_id se resuelven automáticamente
      await this.cart_service.clearCart();
    }

    return {
      order_id: order.id,
      order_number: order.order_number,
      total: order.grand_total,
      subtotal,
      tax_amount: total_tax,
      discount_amount: discountResult.total_discount,
      promotion_discount: discountResult.promotion_discount,
      coupon_discount: discountResult.coupon_discount,
      shipping_cost,
      state: order.state,
      public_order_token: guestArtifacts?.invoice_data_token ?? null,
      invoice_data_token: guestArtifacts?.invoice_data_token ?? null,
      invoice_id: guestArtifacts?.invoice_id ?? invoice_id,
      message: 'Order placed successfully',
    };
  }

  async whatsappCheckout(dto: WhatsappCheckoutDto) {
    await this.assertGuestCheckoutAllowed();

    const user_id = RequestContextService.getUserId();
    const is_guest = !user_id;
    const guest_customer = this.normalizeGuestCustomer(dto.guest_customer);

    const wa_store_id_ctx = RequestContextService.getStoreId();
    let resolved_customer_id: number | null = user_id ?? null;
    if (is_guest && guest_customer && wa_store_id_ctx) {
      const resolved =
        await this.customersService.resolveGuestCustomerForCheckout(
          wa_store_id_ctx,
          guest_customer,
        );
      resolved_customer_id = resolved?.customer_id ?? null;
    }

    // Fetch customer profile and primary address for authenticated users
    let customer_data: {
      first_name: string;
      last_name: string;
      phone: string | null;
      address: {
        address_line1: string;
        address_line2: string | null;
        city: string;
        state_province: string | null;
        country_code: string;
        postal_code: string | null;
        phone_number: string | null;
      } | null;
      email?: string | null;
      document_type?: string | null;
      document_number?: string | null;
    } | null = null;
    let shipping_address_id: number | null = null;
    let shipping_address_snapshot: any = null;

    if (dto.shipping_address) {
      shipping_address_snapshot = dto.shipping_address;
    }

    if (!is_guest) {
      const user = await this.prisma.users.findUnique({
        where: { id: user_id },
        select: { first_name: true, last_name: true, phone: true },
      });

      // addresses is scoped by store_id + user_id automatically
      const primary_address = await this.prisma.addresses.findFirst({
        where: { is_primary: true, type: 'shipping' },
      });

      if (primary_address) {
        shipping_address_id = primary_address.id;
        shipping_address_snapshot = {
          address_line1: primary_address.address_line1,
          address_line2: primary_address.address_line2,
          city: primary_address.city,
          state_province: primary_address.state_province,
          country_code: primary_address.country_code,
          postal_code: primary_address.postal_code,
          phone_number: primary_address.phone_number,
        };
      }

      if (user) {
        customer_data = {
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          phone: user.phone || null,
          email: null,
          document_type: null,
          document_number: null,
          address: shipping_address_snapshot,
        };
      }
    } else if (guest_customer) {
      customer_data = {
        first_name: guest_customer.first_name || '',
        last_name: guest_customer.last_name || '',
        phone: guest_customer.phone || null,
        email: guest_customer.email || null,
        document_type: guest_customer.document_type || null,
        document_number: guest_customer.document_number || null,
        address: shipping_address_snapshot,
      };
    }

    // Build cart_items from either backend cart (authenticated) or DTO items (guest)
    let cart_items: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity: number;
      product: any;
      product_variant: any;
    }>;
    let cart_currency = await this.settingsService.getStoreCurrency();

    // Helper: build cart_items from DTO items (localStorage)
    const buildItemsFromDto = async () => {
      if (!dto.items || dto.items.length === 0) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
      }
      return Promise.all(
        dto.items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            throw new VendixHttpException(ErrorCodes.ECOM_PRODUCT_001);
          }

          let product_variant: any = null;
          if (item.product_variant_id) {
            product_variant = await this.prisma.product_variants.findUnique({
              where: { id: item.product_variant_id },
            });
            if (
              !product_variant ||
              product_variant.product_id !== item.product_id
            ) {
              throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
            }
          }

          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            quantity: item.quantity,
            product,
            product_variant,
          };
        }),
      );
    };

    if (is_guest) {
      // Guest checkout: items come from the DTO (frontend localStorage)
      cart_items = await buildItemsFromDto();
    } else {
      // Authenticated checkout: try backend cart first, fallback to DTO items
      const cart = await this.prisma.carts.findFirst({
        include: {
          cart_items: {
            include: {
              product: true,
              product_variant: true,
            },
          },
        },
      });

      if (cart && cart.cart_items.length > 0) {
        cart_items = cart.cart_items;
        cart_currency = cart.currency;
      } else if (dto.items && dto.items.length > 0) {
        // Fallback: user has items in localStorage but backend cart is empty
        cart_items = await buildItemsFromDto();
      } else {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
      }
    }

    for (const item of cart_items) {
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
      }

      const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
        item.product,
        item.product_variant ?? undefined,
      );

      if (shouldTrack) {
        const availability =
          await this.stockValidatorService.validateAvailability(
            item.product_id,
            item.product_variant_id ?? undefined,
            item.quantity,
          );

        if (!availability.isAvailable) {
          const productName = item.product.name;
          const variantInfo = item.product_variant?.name
            ? ` (${item.product_variant.name})`
            : '';
          throw new VendixHttpException(
            ErrorCodes.ECOM_CART_003,
            `Insufficient stock for ${productName}${variantInfo}: requested ${item.quantity}, available ${availability.available}`,
          );
        }
      }
    }

    const order_number = await this.generateOrderNumber();

    const itemsWithTaxes = await Promise.all(
      cart_items.map(async (item) => {
        const productWithTaxes = await this.prisma.products.findUnique({
          where: { id: item.product_id },
          include: {
            product_tax_assignments: {
              include: {
                tax_categories: {
                  include: {
                    tax_rates: true,
                  },
                },
              },
            },
          },
        });

        const priceResult = this.priceResolverService.resolvePrice({
          product: {
            base_price: Number(productWithTaxes.base_price),
            is_on_sale: productWithTaxes.is_on_sale,
            sale_price:
              productWithTaxes.sale_price != null
                ? Number(productWithTaxes.sale_price)
                : null,
            track_inventory: productWithTaxes.track_inventory,
          },
          variant: item.product_variant
            ? {
                price_override:
                  item.product_variant.price_override != null
                    ? Number(item.product_variant.price_override)
                    : null,
                is_on_sale: item.product_variant.is_on_sale,
                sale_price:
                  item.product_variant.sale_price != null
                    ? Number(item.product_variant.sale_price)
                    : null,
                track_inventory_override:
                  item.product_variant.track_inventory_override,
              }
            : undefined,
        });

        const netPrice = priceResult.unitPrice;

        const taxInfo = await this.taxes_service.calculateProductTaxes(
          item.product_id,
          netPrice,
        );

        const cost_price =
          item.product_variant?.cost_price != null
            ? Number(item.product_variant.cost_price)
            : productWithTaxes.cost_price != null
              ? Number(productWithTaxes.cost_price)
              : null;

        return {
          ...item,
          net_price: netPrice,
          cost_price,
          tax_rate: taxInfo.total_rate,
          tax_amount_item: taxInfo.total_tax_amount,
          total_tax: taxInfo.total_tax_amount * item.quantity,
          total_net: netPrice * item.quantity,
          item_taxes: taxInfo.taxes,
        };
      }),
    );

    const subtotal = this.roundMoney(
      itemsWithTaxes.reduce((sum, item) => sum + item.total_net, 0),
    );
    const total_tax = this.roundMoney(
      itemsWithTaxes.reduce((sum, item) => sum + item.total_tax, 0),
    );

    // Resolve promotional + coupon discounts on the backend (same source of
    // truth used by the normal checkout). Frontend never sends totals.
    const discountResult = await this.resolveCheckoutDiscounts({
      items: itemsWithTaxes.map((item) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? null,
        quantity: item.quantity,
        net_price: item.net_price,
      })),
      customerId: resolved_customer_id,
      couponCode: dto.coupon_code,
    });

    // Resolve optional shipping method/rate from DTO (scoped by store)
    const wa_store_id = RequestContextService.getStoreId();
    let wa_shipping_method_id: number | null = null;
    let wa_shipping_rate_id: number | null = null;
    let wa_shipping_cost = 0;
    let wa_delivery_type:
      | 'pickup'
      | 'home_delivery'
      | 'direct_delivery'
      | 'other' = 'other';

    if (dto.shipping_rate_id) {
      const rate = await this.store_prisma.shipping_rates.findFirst({
        where: { id: dto.shipping_rate_id, is_active: true },
        include: { shipping_method: true, shipping_zone: true },
      });
      if (!rate || rate.shipping_zone.store_id !== wa_store_id) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
      }
      if (
        dto.shipping_method_id &&
        rate.shipping_method_id !== dto.shipping_method_id
      ) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
      }
      wa_shipping_method_id = rate.shipping_method_id;
      wa_shipping_rate_id = rate.id;
      wa_shipping_cost = Number(rate.base_cost);
      wa_delivery_type = deriveDeliveryType(rate.shipping_method.type);
    } else if (dto.shipping_method_id) {
      const method = await this.store_prisma.shipping_methods.findFirst({
        where: {
          id: dto.shipping_method_id,
          store_id: wa_store_id,
          is_active: true,
        },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_INVALID_METHOD_001);
      }
      wa_shipping_method_id = method.id;
      wa_delivery_type = deriveDeliveryType(method.type);
    }

    const grand_total = this.roundMoney(
      Math.max(
        0,
        subtotal + total_tax - discountResult.total_discount + wa_shipping_cost,
      ),
    );

    const order = await this.prisma.orders.create({
      data: {
        order_number,
        customer_id: resolved_customer_id,
        channel: 'whatsapp',
        currency: cart_currency,
        subtotal_amount: subtotal,
        tax_amount: total_tax,
        discount_amount: discountResult.total_discount,
        shipping_cost: wa_shipping_cost,
        shipping_method_id: wa_shipping_method_id,
        shipping_rate_id: wa_shipping_rate_id,
        delivery_type: wa_delivery_type,
        grand_total: grand_total,
        shipping_address_id,
        shipping_address_snapshot,
        state: 'created',
        internal_notes: dto.notes,
        placed_at: new Date(),
        order_items: {
          create: itemsWithTaxes.map((item) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product.name,
            variant_sku: item.product_variant?.sku,
            variant_attributes: item.product_variant?.attributes
              ? JSON.stringify(item.product_variant.attributes)
              : null,
            quantity: item.quantity,
            unit_price: item.net_price,
            total_price: item.total_net,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            cost_price: item.cost_price,
            order_item_taxes: {
              create: item.item_taxes.map((t) => ({
                tax_rate_id: t.tax_rate_id,
                tax_name: t.name,
                tax_rate: t.rate,
                tax_amount: t.amount * item.quantity,
              })),
            },
          })),
        },
      },
      include: {
        order_items: true,
      },
    });

    // Persist promotions + coupon usage (WhatsApp checkout shares the same
    // discount source of truth as the normal checkout flow).
    await this.persistPromotionsAndCoupon({
      orderId: order.id,
      customerId: resolved_customer_id,
      quote: discountResult.quote,
      coupon: discountResult.coupon,
    });

    // Emit order.created event for notifications
    this.eventEmitter.emit('order.created', {
      store_id: order.store_id,
      order_id: order.id,
      order_number: order.order_number,
      grand_total: Number(order.grand_total),
      currency: order.currency,
    });

    for (const item of cart_items) {
      if (!this.shouldReserveStock(item)) continue;
      try {
        // P3.4: Resolves to central warehouse when org scope = ORGANIZATION,
        // otherwise falls back to the legacy per-product default location.
        const location_id = await this.resolveReservationLocationId({
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
        });
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          order.id,
          undefined,
          false, // Already validated stock above
        );
      } catch (error) {
        this.logger.warn(
          `Stock reservation failed for product ${item.product_id}: ${error.message}`,
        );
      }
    }

    // Only clear backend cart for authenticated users
    if (!is_guest) {
      await this.cart_service.clearCart();
    }

    const invoice_id = is_guest
      ? null
      : await this.createInvoiceIfConfigured(order.id);
    const guestArtifacts = is_guest
      ? await this.createGuestOrderArtifacts(order.id, guest_customer)
      : null;

    return {
      order_id: order.id,
      order_number: order.order_number,
      total: order.grand_total,
      public_order_token: guestArtifacts?.invoice_data_token ?? null,
      invoice_data_token: guestArtifacts?.invoice_data_token ?? null,
      invoice_id: guestArtifacts?.invoice_id ?? invoice_id,
      subtotal: subtotal,
      tax: total_tax,
      // Discounts surfaced so the WhatsApp UI / order detail can render
      // the promo + coupon lines without recomputing on the client.
      discount_amount: discountResult.total_discount,
      promotion_discount: discountResult.promotion_discount,
      coupon_discount: discountResult.coupon_discount,
      shipping_cost: wa_shipping_cost,
      item_count: cart_items.reduce((sum, i) => sum + i.quantity, 0),
      items: order.order_items.map((oi) => ({
        name: oi.product_name,
        variant_sku: oi.variant_sku,
        quantity: oi.quantity,
        unit_price: Number(oi.unit_price),
        total_price: Number(oi.total_price),
      })),
      state: order.state,
      customer: customer_data,
      message: 'Order placed successfully via WhatsApp',
    };
  }

  private async generateOrderNumber(): Promise<string> {
    // Obtener store_id del contexto
    const store_id = RequestContextService.getStoreId();

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { store_code: true },
    });

    const store_code = store?.store_code || 'EC';
    const date = new Date();
    const date_str = date.toISOString().slice(2, 10).replace(/-/g, '');

    const start_of_day = new Date(date);
    start_of_day.setUTCHours(0, 0, 0, 0);
    const end_of_day = new Date(date);
    end_of_day.setUTCHours(23, 59, 59, 999);

    // IMPORTANTE: Usar store_prisma para contar TODAS las órdenes de la tienda,
    // no solo las del usuario actual (que es lo que haría this.prisma.orders.count)
    const count = await this.store_prisma.orders.count({
      where: {
        store_id,
        created_at: {
          gte: start_of_day,
          lte: end_of_day,
        },
      },
    });

    const sequence = String(count + 1).padStart(4, '0');
    return `${store_code}-${date_str}-${sequence}`;
  }

  /**
   * Prepare Wompi payment data for the frontend Widget.
   * This endpoint is accessible from eCommerce context (customer JWT + x-store-id header).
   */
  async prepareWompiPayment(dto: {
    order_id: number;
    amount: number;
    currency?: string;
    customer_email?: string;
    redirect_url?: string;
    public_order_token?: string;
  }) {
    const order = await this.store_prisma.orders.findFirst({
      where: { id: dto.order_id },
      select: {
        id: true,
        customer_id: true,
        grand_total: true,
        currency: true,
      },
    });

    if (!order) {
      throw new NotFoundException('No se encontró la orden');
    }

    await this.assertOrderAccess(
      dto.order_id,
      order.customer_id,
      dto.public_order_token,
    );

    // Find Wompi payment method for this store
    const wompiMethod = await this.store_prisma.store_payment_methods.findFirst(
      {
        where: {
          state: 'enabled',
          system_payment_method: { type: 'wompi' },
        },
        include: { system_payment_method: true },
      },
    );

    if (!wompiMethod?.custom_config) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda',
      );
    }

    const config = this.paymentEncryption.decryptConfig(
      wompiMethod.custom_config as Record<string, any>,
      'wompi',
    );

    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };

    const storeId = RequestContextService.getStoreId();
    const client = this.wompiClientFactory.getClient(
      `store-${storeId}`,
      wompiConfig,
    );

    // Resolve the most-recent payment row for this order so we can REUSE its
    // gateway_reference if one was already issued (e.g. user refreshed the
    // checkout page mid-flow). Reusing the reference means the Wompi widget
    // shows the SAME pending transaction instead of creating a parallel one,
    // which would orphan the original reference and confuse webhook lookup.
    const existingPayment = await this.store_prisma.payments.findFirst({
      where: { order_id: dto.order_id },
      include: {
        store_payment_method: {
          include: { system_payment_method: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!existingPayment) {
      throw new BadRequestException(
        'No existe un pago pendiente para esta orden',
      );
    }

    const paymentMethodType =
      existingPayment.store_payment_method?.system_payment_method?.type;
    const paymentMethodProvider =
      existingPayment.store_payment_method?.system_payment_method?.provider;
    if (paymentMethodType !== 'wompi' && paymentMethodProvider !== 'wompi') {
      throw new BadRequestException('La orden no fue creada con Wompi');
    }

    let reference: string;
    if (existingPayment?.gateway_reference) {
      // Reuse — don't overwrite. The widget + webhook + force-confirm will
      // all key off this same reference.
      reference = existingPayment.gateway_reference;
    } else {
      reference = `vendix_${storeId}_${dto.order_id}_${Date.now()}`;
      // Persist on the existing pending payment row (don't overwrite
      // transaction_id — that's the placeholder/real-Wompi-id field).
      await this.store_prisma.payments.update({
        where: { id: existingPayment.id },
        data: {
          gateway_reference: reference,
          updated_at: new Date(),
        },
      });
    }

    const amountInCents = Math.round(Number(order.grand_total) * 100);
    const currency = order.currency || dto.currency || 'COP';

    const integritySignature = client.generateIntegritySignature(
      reference,
      amountInCents,
      currency,
    );

    // Validate redirect_url against the store's registered domains to
    // prevent open-redirect / phishing — the user lands wherever the
    // attacker's frontend tells Wompi to send them otherwise. We accept
    // ONLY the store's own domain_settings hostnames (custom domain or
    // Vendix subdomain) as valid parents.
    const safeRedirectUrl = await this.validateRedirectUrl(
      dto.redirect_url,
      storeId ?? null,
    );

    const tokens = await client.getAcceptanceTokens();

    return {
      public_key: config.public_key,
      currency,
      amount_in_cents: amountInCents,
      reference,
      signature_integrity: integritySignature,
      redirect_url: safeRedirectUrl,
      acceptance_token: tokens.acceptance_token,
      accept_personal_auth: tokens.personal_auth_token,
      customer_email: dto.customer_email || '',
    };
  }

  /**
   * Validate the customer-supplied redirect URL.
   *
   *  - Empty / undefined: allowed (Wompi falls back to its own success page).
   *  - In production: MUST be HTTPS.
   *  - Host MUST belong to the store's `domain_settings` (or be a
   *    subdomain of one of them). This blocks open-redirect /
   *    phishing — an attacker can't trick the widget into sending the
   *    user to `https://attacker.com/?paid=true`.
   *
   * Throws BadRequestException (Spanish message — user-visible via the
   * widget callback chain) on any violation.
   */
  private async validateRedirectUrl(
    rawUrl: string | undefined,
    storeId: number | null,
  ): Promise<string> {
    if (!rawUrl) return '';

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('La URL de redirección no es válida');
    }

    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'La URL de redirección debe usar HTTPS en producción',
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'La URL de redirección debe usar http o https',
      );
    }

    if (!storeId) {
      // No store context — reject conservatively in prod, allow in dev.
      if (isProd) {
        throw new BadRequestException(
          'No se puede validar la URL de redirección sin contexto de tienda',
        );
      }
      return rawUrl;
    }

    // Allowed hosts: every domain registered to this store.
    // Note: `domain_settings` is global; we use the unscoped client
    // through `store_prisma` is fine because we always filter by
    // store_id below.
    const domains = await this.store_prisma.domain_settings.findMany({
      where: { store_id: storeId },
      select: { hostname: true },
    });
    const allowed = domains
      .map((d) => (d.hostname ?? '').toLowerCase())
      .filter((h) => h.length > 0);

    // Always allow the platform's own root domain in dev (so the dev
    // ecommerce served from localhost / vendix.app works).
    const host = parsed.hostname.toLowerCase();
    const isAllowed = allowed.some((h) => host === h || host.endsWith(`.${h}`));

    if (!isAllowed) {
      // In dev, log + allow; in prod, hard reject.
      if (!isProd) {
        this.logger.warn(
          `redirect_url host '${host}' is not registered for store ${storeId}; allowed=[${allowed.join(',')}] (dev mode — permitted)`,
        );
        return rawUrl;
      }
      throw new BadRequestException(
        'La URL de redirección no pertenece a un dominio autorizado de la tienda',
      );
    }

    return rawUrl;
  }

  /**
   * Force-confirm a Wompi payment for an order by polling the Wompi API
   * directly. Used when the customer returns from the Wompi widget — the
   * frontend calls this so the order/payment state reflects reality even if
   * the webhook hasn't arrived yet (it's a fallback for the canonical
   * webhook flow, not a replacement).
   *
   * Lookup priority for the Wompi transaction:
   *   1. payments.transaction_id (real Wompi id, set if any prior webhook landed)
   *   2. payments.gateway_reference (Vendix reference) -> GET /transactions/?reference=
   *
   * Returns the canonical payment state plus a flag indicating whether the
   * payment was already in a terminal state.
   */
  async confirmWompiPayment(
    orderId: number,
    publicOrderToken?: string,
  ): Promise<{
    state: string;
    orderState: string;
    transactionId: string | null;
    alreadyConfirmed: boolean;
    message?: string;
  }> {
    // Use store-scoped client: customer-auth requests carry the resolved
    // store context, and we want defense in depth — the order MUST belong
    // to the store the customer is browsing.
    const order = await this.store_prisma.orders.findFirst({
      where: { id: orderId },
      select: { customer_id: true, state: true },
    });

    if (!order) {
      throw new NotFoundException('No se encontró la orden');
    }

    await this.assertOrderAccess(orderId, order.customer_id, publicOrderToken);

    const payment = await this.store_prisma.payments.findFirst({
      where: { order_id: orderId },
      include: {
        store_payment_method: {
          include: { system_payment_method: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!payment) {
      throw new NotFoundException('No payment record found for this order');
    }

    const paymentMethodType =
      payment.store_payment_method?.system_payment_method?.type;
    const paymentMethodProvider =
      payment.store_payment_method?.system_payment_method?.provider;
    if (paymentMethodType !== 'wompi' && paymentMethodProvider !== 'wompi') {
      throw new BadRequestException('La orden no fue creada con Wompi');
    }

    // Idempotency: if payment is already in a terminal state, skip the
    // Wompi roundtrip and return current state.
    const terminal = [
      'succeeded',
      'captured',
      'failed',
      'cancelled',
      'refunded',
    ];
    if (terminal.includes(payment.state)) {
      return {
        state: payment.state,
        orderState: order?.state ?? 'unknown',
        transactionId: payment.transaction_id,
        alreadyConfirmed: true,
      };
    }

    // Resolve Wompi credentials for this store. We use the store's enabled
    // Wompi method (same lookup as `prepareWompiPayment`).
    const wompiMethod = await this.store_prisma.store_payment_methods.findFirst(
      {
        where: {
          state: 'enabled',
          system_payment_method: { type: 'wompi' },
        },
        include: { system_payment_method: true },
      },
    );

    if (!wompiMethod?.custom_config) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda',
      );
    }

    const config = this.paymentEncryption.decryptConfig(
      wompiMethod.custom_config as Record<string, any>,
      'wompi',
    );

    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };

    const storeId = RequestContextService.getStoreId();
    const cacheKey = `store-${storeId ?? 'unknown'}`;
    const client = this.wompiClientFactory.getClient(cacheKey, wompiConfig);

    // Try to fetch the Wompi transaction:
    //   1. By real transaction id if we already have it
    //   2. By Vendix reference (the canonical case for early-state payments)
    let txn: any = null;
    const placeholderRe = /^[a-z_]+_\d{10,}_[a-z0-9]+$/i;

    if (
      payment.transaction_id &&
      !placeholderRe.test(payment.transaction_id) &&
      // Wompi ids are typically `<digits>-<digits>-<digits>`; the placeholder
      // shape `wompi_<ts>_<rand>` is excluded by the regex above.
      payment.transaction_id.length > 0
    ) {
      try {
        const response = await client.getTransaction(payment.transaction_id);
        if (response?.data?.id) {
          txn = response.data;
        }
      } catch (err) {
        this.logger.warn(
          `Wompi getTransaction failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      const reference = payment.gateway_reference || payment.transaction_id;
      if (!reference) {
        throw new BadRequestException(
          'No Wompi reference or transaction id available to confirm this payment',
        );
      }
      try {
        const response = await client.getTransactionsByReference(reference);
        const txns = response?.data ?? [];
        if (txns.length > 0) {
          txn = txns.reduce((latest: any, candidate: any) => {
            if (!latest) return candidate;
            return new Date(candidate.created_at) > new Date(latest.created_at)
              ? candidate
              : latest;
          }, txns[0]);
        }
      } catch (err) {
        this.logger.warn(
          `Wompi getTransactionsByReference failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      // Wompi doesn't know this reference yet (e.g. user closed widget before
      // submitting). Don't error — the payment row stays pending and the
      // webhook (if any) will still arrive.
      this.logger.log(
        `confirmWompiPayment: no Wompi transaction found for order=${orderId} ref=${payment.gateway_reference}`,
      );
      return {
        state: payment.state,
        orderState: 'pending_payment',
        transactionId: payment.transaction_id,
        alreadyConfirmed: false,
        message: 'No transaction recorded at gateway yet',
      };
    }

    // Apply the txn through the shared webhook-handler logic so we don't
    // duplicate state mapping, idempotency checks, or order-cancel side effects.
    const mappedState = await this.webhookHandler.applyWompiTransaction(txn);

    // Reload payment + order to return the canonical post-apply state.
    const finalPayment = await this.store_prisma.payments.findUnique({
      where: { id: payment.id },
      select: { state: true, transaction_id: true, order_id: true },
    });
    const finalOrder = finalPayment
      ? await this.store_prisma.orders.findUnique({
          where: { id: finalPayment.order_id },
          select: { state: true },
        })
      : null;

    return {
      state: finalPayment?.state ?? mappedState ?? payment.state,
      orderState: finalOrder?.state ?? 'unknown',
      transactionId: finalPayment?.transaction_id ?? payment.transaction_id,
      alreadyConfirmed: false,
    };
  }

  /**
   * Validate, sanitize, and upload a checkout receipt to S3. Returns the
   * S3 key (relative path; no bucket) ready to be persisted on the
   * `payments` row. Throws `VALIDATION_FILE_TYPE` for missing/null MIME or
   * a MIME outside the whitelist.
   *
   * Path shape:
   *   organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/receipts/{YYYY}/{MM}/{uuid}-{sanitized_filename}
   *
   * `sanitized_filename` only keeps `[a-zA-Z0-9._-]`; everything else is
   * replaced with `_` to keep keys safe (S3 accepts more, but the helper's
   * isSafeS3Key guard rejects path-traversal and we want predictable URLs
   * if these keys ever leak into logs).
   */
  private async uploadCheckoutReceipt(
    file: Express.Multer.File,
  ): Promise<string> {
    const mime = file.mimetype;
    if (
      !mime ||
      !CheckoutService.RECEIPT_ALLOWED_MIME_TYPES.includes(mime)
    ) {
      throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
    }

    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // The ecommerce-scoped client filters by store_id but `select` here
    // doesn't include it explicitly — we just need slug+id+organization_id.
    const store = await this.prisma.stores.findFirst({
      select: {
        id: true,
        slug: true,
        organization_id: true,
      },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const organization = await this.store_prisma.organizations.findUnique({
      where: { id: store.organization_id },
      select: { id: true, slug: true },
    });
    if (!organization) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    const basePath = this.s3PathHelper.buildReceiptPath(
      { id: organization.id, slug: organization.slug },
      { id: store.id, slug: store.slug },
    );

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const safeFilename = this.sanitizeReceiptFilename(file.originalname);
    const key = `${basePath}/${year}/${month}/${crypto.randomUUID()}-${safeFilename}`;

    await this.s3Service.uploadFile(file.buffer, key, mime);
    return key;
  }

  /**
   * Strip every character that isn't `[a-zA-Z0-9._-]` from a user-supplied
   * filename. Empty / undefined names collapse to `receipt`. We never
   * include the original path — just the leaf name.
   */
  private sanitizeReceiptFilename(name: string | undefined | null): string {
    const base = (name ?? '').split(/[\\/]/).pop() ?? '';
    const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'receipt';
  }

  private shouldReserveStock(item: any): boolean {
    return this.stockValidatorService.resolveEffectiveTracking(
      item.product,
      item.product_variant ?? undefined,
    );
  }

  /**
   * Resolve the inventory location where the ecommerce reservation must be
   * placed (Plan P3.4 — auto-fulfillment for ORGANIZATION scope).
   *
   * - operating_scope = STORE → fall back to the existing per-product
   *   default location resolver. Behavior unchanged.
   * - operating_scope = ORGANIZATION → reserve at the org's central
   *   warehouse so that the eventual dispatch can move stock from central
   *   to the fulfilling store via an auto-generated transfer (single
   *   decrement at central, single increment at the store).
   *
   * Throws `CENTRAL_WAREHOUSE_NOT_CONFIGURED` (BadRequestException) when an
   * ORG-scope organization has no active central warehouse — the operator
   * MUST configure one before ecommerce orders can be reserved.
   */
  private async resolveReservationLocationId(
    item: { product_id: number; product_variant_id: number | null },
  ): Promise<number> {
    const organization_id = RequestContextService.getOrganizationId();

    if (organization_id) {
      const scope =
        await this.operatingScopeService.getOperatingScope(organization_id);

      if (scope === 'ORGANIZATION') {
        const central =
          await this.operatingScopeService.findCentralWarehouse(organization_id);
        if (!central) {
          throw new BadRequestException({
            code: 'CENTRAL_WAREHOUSE_NOT_CONFIGURED',
            message:
              'Organization operating in ORGANIZATION scope requires a central warehouse to reserve ecommerce stock',
          });
        }
        return central.id;
      }
    }

    // STORE scope (or no org context): keep legacy per-product default.
    return this.stockLevelManager.getDefaultLocationForProduct(
      item.product_id,
      item.product_variant_id ?? undefined,
    );
  }
}
