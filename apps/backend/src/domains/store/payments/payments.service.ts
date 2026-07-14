import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { PaymentGatewayService } from './services/payment-gateway.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import {
  OrderStockCommitService,
  CommitResult,
} from '../inventory/shared/services/order-stock-commit.service';
import { TaxesService } from '../taxes/taxes.service';
import { LocationsService } from '../inventory/locations/locations.service';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
  CreatePosPaymentDto,
  PosOrderItemDto,
  PosPaymentResponseDto,
  UpdateOrderWithPaymentDto,
} from './dto';
import { PaymentError, PaymentErrorCodes, LEGACY_TO_NEW } from './utils';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { buildTaxBreakdown } from 'src/common/interfaces/tax-breakdown.interface';
import { resolveCostPrice } from '../orders/utils/resolve-cost-price';
import { resolveStockUnitsConsumed } from '../products/services/packaging.util';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { calculateSchedule } from '../orders/utils/installment-schedule-calculator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import type {
  PromotionQuoteInput,
  PromotionQuoteResult,
  OrderPromotionSnapshot,
} from '../promotions/dto';
import { CouponsService } from '../coupons/coupons.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { PaymentEncryptionService } from './services/payment-encryption.service';
import { InvoiceDataRequestsService } from '../invoicing/invoice-data-requests/invoice-data-requests.service';
import { WompiClientFactory } from './processors/wompi/wompi.factory';
import { WompiProcessor } from './processors/wompi/wompi.processor';
import { WompiEnvironment } from './processors/wompi/wompi.types';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { RequestContextService } from '@common/context/request-context.service';
import { WithholdingFlowService } from '../withholding-tax/withholding-flow.service';
import type { WithholdingResolution } from '../withholding-tax/withholding-flow.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import { SerialNumberEnforcementService } from '../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../inventory/serial-numbers/inventory-serial-numbers.service';

/**
 * Multi-tarifa (Fase 5.5): snapshot por línea POS. Lleva tanto el dato
 * persistente (tier_id/tier_name/stock_units_consumed) como los insumos de
 * precio (discount_percentage, packaging, override_price) necesarios para
 * recomputar server-side el precio esperado de la tarifa vía
 * `PriceResolverService.resolveWithTier` y así validar el override manual
 * contra el precio de tarifa — no contra el precio base del catálogo.
 */
type PosTierSnapshot = {
  tier_id: number;
  tier_name: string;
  stock_units_consumed: number | null;
  discount_percentage: number;
  units_per_package: number | null;
  is_package_unit: boolean;
  override_price: number | null;
  override_units_per_package: number | null;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: StorePrismaService,
    private paymentGateway: PaymentGatewayService,
    private readonly stockLevelManager: StockLevelManager,
    // Canonical, uniform delivery-commit (skips + reservation consume +
    // availability BLOCK + serial consume + updateStock + inventory_committed).
    private readonly orderStockCommit: OrderStockCommitService,
    private readonly taxes_service: TaxesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly couponsService: CouponsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    private readonly paymentEncryption: PaymentEncryptionService,
    private readonly invoiceDataRequestsService: InvoiceDataRequestsService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly wompiProcessor: WompiProcessor,
    private readonly webhookHandler: WebhookHandlerService,
    private readonly priceResolverService: PriceResolverService,
    private readonly withholdingFlow: WithholdingFlowService,
    private readonly kitchenFireService: KitchenFireService,
    // QUI-431 — serial-number pool + enforcement (no-op for non-serialized
    // products, so they can be invoked unconditionally on the sale path).
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serialNumbers: InventorySerialNumbersService,
  ) {}

  async processPayment(createPaymentDto: CreatePaymentDto, user: any) {
    try {
      await this.validateUserAccess(user, createPaymentDto.storeId);

      const result = await this.paymentGateway.processPayment({
        orderId: createPaymentDto.orderId,
        customerId: createPaymentDto.customerId,
        amount: createPaymentDto.amount,
        currency: createPaymentDto.currency,
        storePaymentMethodId: createPaymentDto.storePaymentMethodId,
        storeId: createPaymentDto.storeId,
        // Back-compat: legacy eCommerce DTO does not yet carry an idempotency
        // key. Initialize a fresh UUID per attempt so each call still maps
        // to a unique provider-side idempotency key. Cross-attempt retry
        // safety requires the caller to start passing a stable key.
        idempotencyKey: crypto.randomUUID(),
        metadata: createPaymentDto.metadata,
        returnUrl: createPaymentDto.returnUrl,
        cancelUrl: createPaymentDto.cancelUrl,
      });

      return {
        success: true,
        data: result,
        message: 'Payment processed successfully',
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        const mapped = LEGACY_TO_NEW[error.code];
        throw new VendixHttpException(mapped, error.message, error.details);
      }
      throw error;
    }
  }

  async processPaymentWithOrder(
    createOrderPaymentDto: CreateOrderPaymentDto,
    user: any,
  ) {
    try {
      await this.validateUserAccess(user, createOrderPaymentDto.storeId);

      const result = await this.paymentGateway.processPaymentWithNewOrder({
        orderId: createOrderPaymentDto.orderId,
        customerId: createOrderPaymentDto.customerId,
        amount: createOrderPaymentDto.amount,
        currency: createOrderPaymentDto.currency,
        storePaymentMethodId: createOrderPaymentDto.storePaymentMethodId,
        storeId: createOrderPaymentDto.storeId,
        // Back-compat: see comment in processPayment above.
        idempotencyKey: crypto.randomUUID(),
        metadata: createOrderPaymentDto.metadata,
        returnUrl: createOrderPaymentDto.returnUrl,
        cancelUrl: createOrderPaymentDto.cancelUrl,
        customerEmail: createOrderPaymentDto.customerEmail,
        customerName: createOrderPaymentDto.customerName,
        customerPhone: createOrderPaymentDto.customerPhone,
        items: createOrderPaymentDto.items || [],
        billingAddressId: createOrderPaymentDto.billingAddressId,
        shippingAddressId: createOrderPaymentDto.shippingAddressId,
      });

      return {
        success: true,
        data: result,
        message: 'Order created and payment processed successfully',
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        const mapped = LEGACY_TO_NEW[error.code];
        throw new VendixHttpException(mapped, error.message, error.details);
      }
      throw error;
    }
  }

  async refundPayment(
    paymentId: string,
    refundPaymentDto: RefundPaymentDto,
    user: any,
  ) {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: paymentId },
        include: {
          orders: {
            include: { stores: true },
          },
        },
      });

      if (!payment) {
        throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
      }

      await this.validateUserAccess(user, payment.orders.stores.id);

      const result = await this.paymentGateway.refundPayment(
        paymentId,
        refundPaymentDto.amount,
        refundPaymentDto.reason,
      );

      return {
        success: true,
        data: result,
        message: 'Payment refunded successfully',
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        const mapped = LEGACY_TO_NEW[error.code];
        throw new VendixHttpException(mapped, error.message, error.details);
      }
      throw error;
    }
  }

  async getPaymentStatus(paymentId: string, user: any) {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: paymentId },
        include: {
          orders: {
            include: { stores: true },
          },
        },
      });

      if (!payment) {
        throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
      }

      await this.validateUserAccess(user, payment.orders.stores.id);

      const status = await this.paymentGateway.getPaymentStatus(paymentId);

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        const mapped = LEGACY_TO_NEW[error.code];
        throw new VendixHttpException(mapped, error.message, error.details);
      }
      throw error;
    }
  }

  /**
   * Force-confirm a POS Wompi payment by polling Wompi for the canonical
   * transaction state and applying it through the shared webhook-handler
   * code path. Used by the POS frontend when:
   *  - The user returns from a redirect/3DS flow.
   *  - The cashier hits "Verify now" while waiting for an async method
   *    (PSE / NEQUI / BANCOLOMBIA_TRANSFER).
   *  - The webhook hasn't arrived yet but the transaction has finalized.
   *
   * Mirrors `CheckoutService.confirmWompiPayment` (ecommerce) but keyed by
   * `payments.id` (DB primary key) instead of `order_id` — POS callers
   * already know the payment id from the create response.
   *
   * Idempotent: returns immediately if the payment is in a terminal state.
   * Reuses `WebhookHandlerService.applyWompiTransaction` so state mapping,
   * CAS guards, and order-side effects are identical across webhook /
   * reconciliation cron / ecommerce confirm / POS confirm paths.
   */
  async confirmPosWompiPayment(
    paymentId: number,
    user: any,
  ): Promise<{
    state: string;
    transactionId: string | null;
    alreadyConfirmed: boolean;
    message?: string;
  }> {
    const payment = await this.prisma.payments.findUnique({
      where: { id: paymentId },
      include: {
        store_payment_method: { include: { system_payment_method: true } },
        orders: { include: { stores: true } },
      },
    });

    if (!payment) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    if (payment.store_payment_method?.system_payment_method?.type !== 'wompi') {
      throw new BadRequestException('Payment is not a Wompi transaction');
    }

    // Tenant guard — POS controller is JWT-protected so user is the cashier
    if (payment.orders?.stores?.id) {
      await this.validateUserAccess(user, payment.orders.stores.id);
    }

    // Idempotency: terminal-state payments don't need a Wompi roundtrip
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
        transactionId: payment.transaction_id,
        alreadyConfirmed: true,
      };
    }

    // Resolve per-tenant Wompi credentials from the store_payment_method row
    const customConfig = payment.store_payment_method?.custom_config;
    if (!customConfig) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda',
      );
    }

    const config = this.paymentEncryption.decryptConfig(
      customConfig as Record<string, any>,
      'wompi',
    );

    if (!config.public_key || !config.private_key) {
      throw new BadRequestException('Credenciales Wompi incompletas');
    }

    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };

    const cacheKey = `store-${payment.orders?.stores?.id ?? 'unknown'}`;
    const client = this.wompiClientFactory.getClient(cacheKey, wompiConfig);

    // Lookup priority — match WompiReconciliationService.reconcileOne and
    // CheckoutService.confirmWompiPayment to keep behavior consistent:
    //  1. transaction_id (if it looks like a real Wompi id, not the
    //     placeholder format `wompi_<ts>_<rand>` or `vendix_*`)
    //  2. gateway_reference -> /v1/transactions/?reference=
    let txn: any = null;
    const placeholderRe = /^[a-z_]+_\d{10,}_[a-z0-9]+$/i;

    if (
      payment.transaction_id &&
      !placeholderRe.test(payment.transaction_id) &&
      !payment.transaction_id.startsWith('wompi_') &&
      payment.transaction_id.length > 0
    ) {
      try {
        const response = await client.getTransaction(payment.transaction_id);
        if (response?.data?.id) {
          txn = response.data;
        }
      } catch (err) {
        this.logger.warn(
          `confirmPosWompiPayment getTransaction failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      const reference = payment.gateway_reference || payment.transaction_id;
      if (!reference) {
        return {
          state: payment.state,
          transactionId: payment.transaction_id,
          alreadyConfirmed: false,
          message: 'No reference available to confirm payment',
        };
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
          `confirmPosWompiPayment getTransactionsByReference failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      // Wompi has no record of the transaction yet — caller should retry.
      this.logger.log(
        `confirmPosWompiPayment: no Wompi transaction found for paymentId=${paymentId} ref=${payment.gateway_reference}`,
      );
      return {
        state: payment.state,
        transactionId: payment.transaction_id,
        alreadyConfirmed: false,
        message: 'No transaction recorded at gateway yet',
      };
    }

    // Apply via shared atomic state machine. Same path used by webhook
    // arrivals and the reconciliation cron — guarantees identical idempotency
    // semantics and side effects.
    const mappedState = await this.webhookHandler.applyWompiTransaction(txn);

    const updated = await this.prisma.payments.findUnique({
      where: { id: payment.id },
      select: { state: true, transaction_id: true },
    });

    return {
      state: updated?.state ?? mappedState ?? payment.state,
      transactionId: updated?.transaction_id ?? payment.transaction_id,
      alreadyConfirmed: false,
    };
  }

  async findAll(query: PaymentQueryDto, user: any) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      orderId,
      customerId,
      storeId,
      paymentMethodType,
      dateFrom,
      dateTo,
      sort,
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { transaction_id: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.state = status;
    }

    if (orderId) {
      where.order_id = orderId;
    }

    if (customerId) {
      where.customer_id = customerId;
    }

    if (customerId) {
      where.customer_id = customerId;
    }

    // Manual store filtering removed - handled by StorePrismaService
    // StorePrismaService automatically injects: where orders: { store_id: context.store_id }

    // However, if we want to filter by specific storeId WITHIN the allowed context (implicit)
    // we can keep it, but getting User Store Ids is redundant if strictly scoped.
    if (storeId) {
      // Redundant if store_id == context.store_id, but harmless.
      // If storeId != context.store_id, query returns empty (correct).
      where.orders = {
        store_id: storeId,
      };
    } else {
      // Ensure we are filtering by orders relevant to this context
      // StorePrismaService does this automatically via relational scope.
    }

    if (paymentMethodType) {
      where.store_payment_method = {
        system_payment_method: {
          type: paymentMethodType,
        },
      };
    }

    if (dateFrom && dateTo) {
      where.created_at = {
        gte: new Date(dateFrom),
        lte: new Date(dateTo),
      };
    }

    const orderBy: any = {};
    if (sort) {
      const [field, direction] = sort.split(':');
      orderBy[field] = direction === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [payments, total] = await Promise.all([
      this.prisma.payments.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          orders: {
            select: {
              id: true,
              order_number: true,
              state: true,
              stores: {
                select: { id: true, name: true, store_code: true },
              },
            },
          },
          payment_methods: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
      this.prisma.payments.count({ where }),
    ]);

    return {
      data: payments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(paymentId: string, user: any) {
    const payment = await this.prisma.payments.findFirst({
      where: { transaction_id: paymentId },
      include: {
        orders: {
          include: {
            stores: true,
            order_items: {
              include: {
                products: true,
                product_variants: true,
              },
            },
          },
        },
        store_payment_method: true,
        refunds: true,
      },
    });

    if (!payment) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    // Check if user has access to this payment's store
    // The payment is linked to an order, which is linked to a store
    if (payment.orders && payment.orders.store_id) {
      await this.validateUserAccess(user, payment.orders.store_id);
    } else {
      // If for some reason order linkage is missing (should not happen)
      // For safety, only super_admin should access orphaned records
      if (!user.roles || !user.roles.includes('super_admin')) {
        throw new VendixHttpException(ErrorCodes.PAY_PERM_001);
      }
    }

    return {
      data: payment,
    };
  }

  private async validateUserAccess(user: any, storeId: number): Promise<void> {
    // 1. Allow super_admin to access any store
    if (user.roles && user.roles.includes('super_admin')) {
      return;
    }

    // 2. Check if user is explicitly assigned to the store (store_users)
    const userStoreIds = await this.getUserStoreIds(user);
    if (userStoreIds.includes(storeId)) {
      return;
    }

    // 3. Check if user's main_store_id matches the requested store
    if (user.main_store_id === storeId) {
      return;
    }

    // 4. Check if user's current token store_id matches the requested store
    if (user.store_id === storeId) {
      return;
    }

    // 5. Check if user is Owner or Admin of the Organization that owns the store
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });

    if (store && user.organization_id === store.organization_id) {
      if (
        user.roles &&
        (user.roles.includes('owner') || user.roles.includes('admin'))
      ) {
        return;
      }
    }

    // 6. Access denied
    throw new VendixHttpException(ErrorCodes.PAY_PERM_001);
  }

  /**
   * Process POS payment - unified entry point for all POS sales
   */
  async processPosPayment(
    createPosPaymentDto: CreatePosPaymentDto,
    user: any,
  ): Promise<PosPaymentResponseDto> {
      // Resolve store_id from RequestContext (authoritative). Backward-compat:
      // if the client sent store_id in body, validate it matches the context.
      const context = RequestContextService.getContext();
      const ctxStoreId = context?.store_id;

      if (!ctxStoreId) {
        throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
      }

      if (
        createPosPaymentDto.store_id !== undefined &&
        createPosPaymentDto.store_id !== null &&
        createPosPaymentDto.store_id !== ctxStoreId
      ) {
        throw new VendixHttpException(
          ErrorCodes.STORE_CONTEXT_001,
          'store_id in body does not match the authenticated context',
        );
      }
      createPosPaymentDto.store_id = ctxStoreId;

      await this.validateUserAccess(user, createPosPaymentDto.store_id);

      // Resolve store currency once if not provided in DTO
      if (!createPosPaymentDto.currency) {
        createPosPaymentDto.currency =
          await this.settingsService.getStoreCurrency();
      }

      // Enforce require_session_for_sales setting
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (cr_settings?.enabled && cr_settings?.require_session_for_sales) {
        const session = await this.sessionsService.getActiveSession(user.id);
        if (!session) {
          throw new BadRequestException(
            'Se requiere una caja registradora abierta para procesar ventas.',
          );
        }
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Create or update order. Backend recalculates promotions/coupon
        // server-side and returns the persistence-ready snapshots so this
        // function can write `order_promotions` + `coupon_uses` consistently.
        const orderCreation = (await this.createOrUpdateOrderFromPos(
          tx,
          createPosPaymentDto,
          user,
        ))!;
        const order = orderCreation.order;
        // QUI-431 — ¿la venta tiene productos serializados? Calculado UNA vez
        // dentro de `createOrUpdateOrderFromPos` (antes de crear la orden, para
        // poder forzar su delivery_type) y reutilizado aquí en el gate de
        // inventario (paso 3) y la máquina de estados (`deferToFulfillment`).
        const hasSerialized = orderCreation.hasSerialized;

        // Plan KDS fire-flows (B5): the auto-fire result captured inside
        // the larger payment $transaction. Defaults to null when the store
        // is not a restaurant OR when the order has nothing `prepared` to
        // fire. After commit the helper `emitKitchenFiredAfterCommit` is
        // called from outside the transaction so the kitchen.fired event
        // + SSE push are NEVER fired before the database commits.
        let kitchenFireResult:
          | {
              ticketId: number;
              firedItemSnapshots: Array<{
                orderItemId: number;
                productId: number;
                productName: string;
                quantity: number;
              }>;
              cogsTotal: number;
              consumedLineCount: number;
            }
          | null = null;

        // Plan KDS fire-flows (B6): when the payment closed out a table
        // session, the auto-fire already ran INSIDE
        // `applyPosPaymentToTableSession` (so it is atomic with the
        // session close). Adopt its result here so the response, the
        // `hasKitchenItems` discriminator, and the post-commit
        // `kitchen.fired` emission all behave exactly like the fresh-sale
        // B5 path. The B5 auto-fire block further below becomes a no-op
        // for these items (their `inventory_consumed_at_fire` flag is now
        // true).
        if (orderCreation.kitchenFire) {
          kitchenFireResult = orderCreation.kitchenFire;
        }

        // Restaurant POS — detect whether this order has at least one kitchen
        // ticket actually fired to the KDS. `skipKds` lines never create a
        // ticket, so this discriminator ("esperar cocina") is true only when
        // real prepared items were sent to the kitchen. Scoped by the same
        // transaction client (kitchen_tickets is store-scoped); we also
        // exclude cancelled tickets. When true, the payment leaves the order
        // in `processing` instead of `finished`.
        // Plan KDS fire-flows (B5): the `hasKitchenItems` flag decides
        // whether the order stays in `processing` (kitchen is working
        // on it) or moves to `finished` (kitchen is not in the loop).
        // We start by reading pre-existing tickets (manual fire) and
        // upgrade the flag to `true` after the auto-fire block below
        // runs (which may create new tickets). The `let` binding is
        // required because the auto-fire runs later in the same
        // closure.
        const orderKitchenTickets = await tx.kitchen_tickets.findMany({
          where: { order_id: order.id, status: { not: 'cancelled' } },
          select: { id: true },
        });
        let hasKitchenItems = (orderKitchenTickets?.length ?? 0) > 0;

        const promotionsSnapshot: OrderPromotionSnapshot[] =
          orderCreation.promotionsSnapshot ?? [];
        const appliedPromotionDetails =
          orderCreation.appliedPromotions ?? [];
        const couponInfo = orderCreation.couponInfo ?? {
          coupon_id: null as number | null,
          coupon_code: null as string | null,
          discount_amount: 0,
        };

        // 1.5. BLOCKING stock validation using stock_levels (source of truth)
        // Validate ALL items before any reservation occurs
        // Oversell is intentionally not controlled by the public POS payload.
        const allowOversell = false;

        for (const item of order.order_items) {
          if (!item.product_id) continue;

          const product = await tx.products.findUnique({
            where: { id: item.product_id },
            select: {
              track_inventory: true,
              name: true,
            },
          });

          if (!product?.track_inventory) continue;

          // Get actual available stock from stock_levels table (source of truth)
          // Aggregate across store-local, sellable locations only.
          // POS canal MUST exclude central warehouse and non-sellable types
          // (quarantine / damaged_goods) per Plan §6.4.3 + regla 17/19.
          const stockAggregate = await tx.stock_levels.aggregate({
            where: {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              inventory_locations: {
                store_id: order.store_id,
                is_central_warehouse: false,
                is_active: true,
                type: { notIn: ['quarantine', 'damaged_goods'] },
              },
            },
            _sum: {
              quantity_available: true,
            },
          });

          const available = stockAggregate._sum.quantity_available ?? 0;

          const requiredStock =
            typeof item.stock_units_consumed === 'number' &&
            item.stock_units_consumed > 0
              ? item.stock_units_consumed
              : item.quantity;

          // BLOCK: If not allowing oversell and required units exceed available, throw immediately.
          if (!allowOversell && requiredStock > available) {
            const variantInfo = item.product_variant_id
              ? ` (variant ${item.product_variant_id})`
              : '';
            const packageHint =
              requiredStock !== item.quantity
                ? ` (${item.quantity} x ${requiredStock / Math.max(item.quantity, 1)} unid/empaque)`
                : '';
            throw new VendixHttpException(
              ErrorCodes.POS_STOCK_INSUFFICIENT_001,
              `Stock insuficiente para ${product.name}${variantInfo}: requiere ${requiredStock} unidades${packageHint}, disponible ${available}.`,
            );
          }
        }

        // Resolve default location inside tx to avoid scoping mismatch with getDefaultLocationForProduct()
        // POS canal MUST exclude central warehouse and non-sellable types
        // (quarantine / damaged_goods) per Plan §6.4.3 + regla 17/19.
        const defaultLocation = await tx.inventory_locations.findFirst({
          where: {
            store_id: order.store_id,
            is_active: true,
            is_central_warehouse: false,
            type: { notIn: ['quarantine', 'damaged_goods'] },
          },
          orderBy: { id: 'asc' },
          select: { id: true },
        });

        for (const item of order.order_items) {
          if (!item.product_id) continue;

          const product = await tx.products.findUnique({
            where: { id: item.product_id },
            select: { track_inventory: true },
          });
          if (!product?.track_inventory) continue;
          try {
            // Use savepoint to isolate stock reservation errors from the main transaction.
            // PostgreSQL aborts the entire transaction on any error; a savepoint lets us
            // catch and rollback just the failed operation while keeping the transaction alive.
            await tx.$executeRawUnsafe('SAVEPOINT stock_reserve_sp');

            // Use stock_level with highest available for this product, falling back to store default location.
            // POS canal MUST exclude central warehouse and non-sellable types
            // (quarantine / damaged_goods) per Plan §6.4.3 + regla 17/19.
            const stockLevel = await tx.stock_levels.findFirst({
              where: {
                product_id: item.product_id,
                product_variant_id: item.product_variant_id || null,
                quantity_available: { gt: 0 },
                inventory_locations: {
                  store_id: order.store_id,
                  is_central_warehouse: false,
                  is_active: true,
                  type: { notIn: ['quarantine', 'damaged_goods'] },
                },
              },
              orderBy: { quantity_available: 'desc' },
              select: { location_id: true },
            });
            const location_id = stockLevel?.location_id || defaultLocation?.id;

            if (!location_id) {
              await tx.$executeRawUnsafe(
                'ROLLBACK TO SAVEPOINT stock_reserve_sp',
              );
              this.logger.warn(
                `No location found for stock reservation of product ${item.product_id} in order #${order.id}`,
              );
              continue;
            }

            // Multi-tarifa (Fase 5.5): si el item persistió stock_units_consumed
            // (>0), pasarlo como override al reservador para descontar la
            // cantidad real de unidades de stock (empaque por tarifa, cuando el
            // packSize resuelto de la tarifa/override es > 1).
            const stockUnitsConsumed =
              typeof item.stock_units_consumed === 'number' &&
              item.stock_units_consumed > 0
                ? item.stock_units_consumed
                : undefined;
            await this.stockLevelManager.reserveStock(
              item.product_id,
              item.product_variant_id || undefined,
              location_id,
              item.quantity,
              'order',
              order.id,
              user?.id,
              false, // Already validated above against stock_levels source of truth.
              tx,
              undefined, // expires_at
              false, // skip_reservation
              stockUnitsConsumed,
            );

            await tx.$executeRawUnsafe('RELEASE SAVEPOINT stock_reserve_sp');
          } catch (error) {
            // Rollback to savepoint to recover the transaction from PostgreSQL's aborted state
            try {
              await tx.$executeRawUnsafe(
                'ROLLBACK TO SAVEPOINT stock_reserve_sp',
              );
            } catch {}
            this.logger.warn(
              `Stock reservation failed for product ${item.product_id} in order #${order.id}: ${error.message}`,
            );
          }
        }

        // 1.6. Persist promotions from the server-recalculated snapshot.
        // Backend already validated each promotion via `quoteDiscounts` and
        // the `order_promotions_snapshot` array contains one entry per
        // applied promotion (manual + auto). Inserting from the snapshot
        // guarantees `order_promotions.discount_amount` matches the
        // `orders.discount_amount` totals computed earlier.
        for (const promo of promotionsSnapshot) {
          try {
            await this.promotionEngine.applyPromotion(
              order.id,
              promo.promotion_id,
              promo.discount_amount,
              createPosPaymentDto.customer_id ?? null,
              tx,
            );
          } catch (e) {
            this.logger.warn(
              `[POS] Failed to persist order_promotion for promotion_id=${promo.promotion_id}: ${(e as Error).message}`,
            );
          }
        }

        // ----------------------------------------------------------------
        // Plan KDS fire-flows (B5): auto-fire `prepared` items to the kitchen
        // for restaurant stores, INSIDE the payment $transaction so the
        // `inventory_consumed_at_fire` flag flip + the per-leaf stock
        // consumption + the kitchen_ticket create are atomic with the order
        // write. After commit, the `kitchen.fired` event + SSE push run from
        // outside the transaction (anti-pattern: do not emit before commit).
        //
        // Gating: only restaurant stores. Non-restaurant stores keep the
        // existing `updateInventoryFromOrder` path which moves stock as
        // `sales` movement at payment (no COGS recognition split).
        //
        // skip_kds lines: NEVER fired. They are routed through
        // `updateInventoryFromOrder` (the existing guard
        // `inventory_consumed_at_fire` is FALSE for them so the sale
        // movement runs). Their own stock is consumed at payment.
        //
        // home_delivery / credit sale: we still fire here. Fire is
        // independent of delivery; the kitchen must receive the order when
        // it is paid, regardless of whether the customer is in-store or
        // waiting at home. The state machine (processing vs finished) is
        // handled by `updateOrderPaymentStatus` based on
        // `hasKitchenItems`.
        // ----------------------------------------------------------------
        if (createPosPaymentDto.requires_payment && !createPosPaymentDto.is_draft) {
          // Resolve industries once per call (no cache to keep the patch
          // safe; the per-payment cost is one extra small query).
          const storeRow = await tx.stores.findUnique({
            where: { id: createPosPaymentDto.store_id },
            select: { industries: true },
          });
          if (storeIsRestaurant(storeRow?.industries)) {
            // Collect candidate order_item_ids: all `prepared` items
            // with skip_kds=false. Persisted items already carry the
            // product_type via the products relation; we re-load the
            // items with their product_type to be safe.
            const fireableItems = await tx.order_items.findMany({
              where: {
                order_id: order.id,
                skip_kds: false,
                product_id: { not: null },
                inventory_consumed_at_fire: false,
                products: { product_type: 'prepared' },
              },
              select: { id: true, product_id: true },
            });
            const candidateIds = fireableItems.map((i) => i.id);
            if (candidateIds.length > 0) {
              // prepareFireContext uses the scoped prisma client (this
              // service's `prisma` field), reads recipes + BOM + default
              // locations OUTSIDE this $transaction. Safe because they
              // are catalog reads (no race with the fire write).
              // Plan KDS fire-flows (B5): pass the caller's `tx` so
              // the catalog reads (recipes, BOM, locations) happen
              // on the SAME connection as the order write. Without
              // this, prepareFireContext would use a separate
              // connection that cannot see the just-inserted
              // order_items and KITCHEN_FIRE_ORDER_NOT_FOUND would
              // bubble up to the POS.
              const ctx = await this.kitchenFireService.prepareFireContext(
                order.id,
                candidateIds,
                tx,
              );
              if (ctx && ctx.firedItemIds.length > 0) {
                // store_id is narrowed to non-null in
                // `createOrUpdateOrderFromPos` (throws on null at line
                // ~2384). Re-assert locally so TS is happy.
                if (createPosPaymentDto.store_id == null) {
                  throw new VendixHttpException(
                    ErrorCodes.STORE_CONTEXT_001,
                  );
                }
                kitchenFireResult =
                  await this.kitchenFireService.fireOrderItemsInTx(
                    tx,
                    createPosPaymentDto.store_id,
                    ctx,
                  );
              }
            }
          }
        }

        // Plan KDS fire-flows (B5): if the auto-fire created a new
        // kitchen ticket, the order must stay in `processing` (the
        // kitchen is now working on it). Flip the flag so the
        // downstream `updateOrderPaymentStatus` call picks the right
        // branch.
        if (kitchenFireResult !== null) {
          hasKitchenItems = true;
        }

        let inventoryCost = 0;

        // 2. Process payment if required
        let payment: any = null;
        const isDigitalPayment =
          createPosPaymentDto.requires_payment &&
          ['wompi', 'wallet'].includes(
            (
              await tx.store_payment_methods.findUnique({
                where: { id: createPosPaymentDto.store_payment_method_id },
                include: { system_payment_method: true },
              })
            )?.system_payment_method?.type || '',
          );

        if (createPosPaymentDto.requires_payment && !isDigitalPayment) {
          // Direct methods (cash, card, bank_transfer) — process inside transaction
          payment = await this.processPosPaymentTransaction(
            tx,
            order,
            createPosPaymentDto,
          );
          await this.updateOrderPaymentStatus(
            tx,
            order.id,
            'succeeded',
            // QUI-431 — difiere a fulfillment para domicilio O serializado.
            // OJO: tras forzar el delivery_type, order.delivery_type ya es
            // 'pickup' para serializado, por eso se incluye `hasSerialized`.
            order.delivery_type === 'home_delivery' || hasSerialized,
            hasKitchenItems,
          );
        } else if (isDigitalPayment) {
          // Digital methods (Wompi, wallet) — mark as pending, process AFTER commit
          await this.updateOrderPaymentStatus(
            tx,
            order.id,
            'pending_payment',
            // QUI-431 — difiere a fulfillment para domicilio O serializado.
            order.delivery_type === 'home_delivery' || hasSerialized,
            hasKitchenItems,
          );
        } else if (!createPosPaymentDto.is_draft) {
          // Credit sale - update order status
          // Drafts skip this branch entirely (no payment status / no credit flow).
          await this.updateOrderPaymentStatus(
            tx,
            order.id,
            'pending_payment',
            // QUI-431 — difiere a fulfillment para domicilio O serializado.
            order.delivery_type === 'home_delivery' || hasSerialized,
            hasKitchenItems,
          );
        }

        // 3. Update inventory only when product is physically delivered
        // Direct delivery with payment = finished = product left our hands
        // Any other flow (home_delivery, credit sale) = keep reservation until delivery/cancellation
        // QUI-431 — los productos serializados NO se entregan/consumen al
        // instante: se cobran pero la reserva queda ACTIVA y el serial se
        // registra luego en una remisión. Por eso `!hasSerialized` excluye la
        // venta serializada de `updateInventoryFromOrder` (no se consume stock
        // ni se marcan seriales como vendidos en este punto).
        const isDirectDeliveryFinished =
          createPosPaymentDto.requires_payment &&
          order.delivery_type !== 'home_delivery' &&
          !hasSerialized;


        if (createPosPaymentDto.update_inventory && isDirectDeliveryFinished) {
          // QUI-431 — POS serial selection. Pass the DTO lines so
          // `updateInventoryFromOrder` can consume the operator-chosen serials
          // for serialized products. Ecommerce/credit/other channels reach the
          // same method with no DTO lines and auto-select FIFO.
          inventoryCost = (
            await this.updateInventoryFromOrder(
              tx,
              order,
              createPosPaymentDto.items,
            )
          ).totalCost;
        }

        // 4. Emit order/payment events — drafts skip ALL events because they
        // are not real sales (no accounting, no credit_sale, no COGS).
        if (!createPosPaymentDto.is_draft) {
          // Typed tax breakdown so accounting posts one journal line per fiscal
          // type (IVA → 2408, INC → 2436, ICA → 241205) instead of collapsing to
          // 2408. Read from the persisted, typed order_item_taxes rows.
          const orderItemsWithTaxes = await tx.order_items.findMany({
            where: { order_id: order.id },
            select: {
              order_item_taxes: { select: { tax_type: true, tax_amount: true } },
            },
          });
          const tax_breakdown = buildTaxBreakdown(
            orderItemsWithTaxes.flatMap((i) => i.order_item_taxes || []),
          );

          // CASO 2 (suffered): a customer who is a withholding agent retains
          // us on this sale, turning the withheld amount into an advance asset
          // (1355). Resolve ONCE here so both the payment.received and the
          // credit_sale.created branches (mutually exclusive) share the same
          // result without duplicating work or persistence. Zero-regression:
          // tenant.is_withholding_agent=false or no customer_id → lines:[]; we
          // degrade to an empty resolution on any failure so the sale never
          // breaks because of withholding.
          let wh: WithholdingResolution = {
            lines: [],
            uvt_value_used: 0,
            counterparty_type: null,
          };
          try {
            const customer_id = order.customer_id
              ? Number(order.customer_id)
              : null;
            wh = await this.withholdingFlow.resolveSuffered({
              organization_id: order.stores?.organization_id,
              store_id: createPosPaymentDto.store_id,
              customer_id,
              base: Number(order.subtotal_amount || 0),
              ivaAmount: Number(order.tax_amount || 0),
            });
          } catch (error) {
            this.logger.warn(
              `resolveSuffered failed for order ${order.id}; degrading to no withholding: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            wh = { lines: [], uvt_value_used: 0, counterparty_type: null };
          }

          // 4a. Emit order.created event
          this.eventEmitter.emit('order.created', {
            store_id: createPosPaymentDto.store_id,
            order_id: order.id,
            order_number: order.order_number,
            grand_total: Number(order.grand_total),
            currency: order.currency || createPosPaymentDto.currency,
          });

          // 5. Emit payment event (with tax/subtotal for IVA accounting)
          if (payment) {
            this.eventEmitter.emit('payment.received', {
              payment_id: payment.id,
              store_id: createPosPaymentDto.store_id,
              organization_id: order.stores?.organization_id,
              order_id: order.id,
              order_number: order.order_number,
              amount: payment.amount,
              subtotal_amount: Number(order.subtotal_amount || 0),
              tax_amount: Number(order.tax_amount || 0),
              tax_breakdown,
              withholding_breakdown: wh.lines,
              discount_amount: Number(order.discount_amount || 0),
              // GAP-6 — propina (sin IVA). El asiento la reconoce como pasivo
              // custodio (CR propinas por pagar) para cuadrar el DR caja que ya
              // incluye la propina dentro de payment.amount (= grand_total).
              tip_amount: Number(order.tip_amount || 0),
              currency: payment.currency || createPosPaymentDto.currency,
              payment_method:
                payment.store_payment_method?.system_payment_method
                  ?.display_name || 'Unknown',
              user_id: user.id,
              // C4-followup: solo tenemos el id en memoria en este flujo POS
              // (order.customer_id escalar) — name/tax_id quedan undefined a
              // propósito para no introducir un lookup N+1 aquí.
              customer: order.customer_id
                ? { id: Number(order.customer_id) }
                : undefined,
            });

            // Persist suffered withholding once for the immediate-payment
            // branch (mutually exclusive with credit_sale.created). Safe to
            // call unconditionally: persistWithholdingLines filters empty/
            // concept-less lines and writes nothing when wh.lines is empty.
            await this.withholdingFlow.persistWithholdingLines({
              organization_id: order.stores?.organization_id,
              store_id: createPosPaymentDto.store_id,
              invoice_id: null,
              customer_id: order.customer_id
                ? Number(order.customer_id)
                : null,
              role: 'suffered',
              counterparty_type: wh.counterparty_type,
              uvt_value_used: wh.uvt_value_used,
              lines: wh.lines,
            });

            // 5b. Emit order.completed for COGS on direct POS sales
            if (order.delivery_type === 'direct_delivery') {
              const total_cost = inventoryCost;
              if (total_cost > 0) {
                this.eventEmitter.emit('order.completed', {
                  order_id: order.id,
                  order_number: order.order_number,
                  organization_id: order.stores?.organization_id,
                  store_id: createPosPaymentDto.store_id,
                  total_cost,
                  user_id: user.id,
                });
              }
            }
          }

          // 5c. Emit credit_sale.created for credit sales (no payment)
          if (!createPosPaymentDto.requires_payment) {
            this.eventEmitter.emit('credit_sale.created', {
              order_id: order.id,
              organization_id: order.stores?.organization_id,
              store_id: createPosPaymentDto.store_id,
              order_number: order.order_number,
              subtotal_amount: Number(order.subtotal_amount || 0),
              tax_amount: Number(order.tax_amount || 0),
              tax_breakdown,
              withholding_breakdown: wh.lines,
              discount_amount: Number(order.discount_amount || 0),
              total_amount: Number(order.grand_total || 0),
              user_id: user.id,
            });

            // Persist suffered withholding once for the credit-sale branch
            // (mutually exclusive with payment.received). Safe to call
            // unconditionally: persistWithholdingLines writes nothing when
            // wh.lines is empty.
            await this.withholdingFlow.persistWithholdingLines({
              organization_id: order.stores?.organization_id,
              store_id: createPosPaymentDto.store_id,
              invoice_id: null,
              customer_id: order.customer_id
                ? Number(order.customer_id)
                : null,
              role: 'suffered',
              counterparty_type: wh.counterparty_type,
              uvt_value_used: wh.uvt_value_used,
              lines: wh.lines,
            });
          }
        }

        // 5d. Register coupon use from the server-recalculated coupon
        // discount. The frontend's `dto.discount_amount` is intentionally
        // ignored — only the value returned by `CouponsService.validate`
        // (computed server-side) is persisted in `coupon_uses`, kept
        // separate from the promotional discount stored in `order_promotions`.
        if (couponInfo.coupon_id && couponInfo.discount_amount > 0) {
          await tx.coupon_uses.create({
            data: {
              coupon_id: couponInfo.coupon_id,
              order_id: order.id,
              customer_id: createPosPaymentDto.customer_id || null,
              discount_applied: couponInfo.discount_amount,
            },
          });
          await tx.coupons.update({
            where: { id: couponInfo.coupon_id },
            data: { current_uses: { increment: 1 } },
          });
        }

        // 6. Send confirmation if required
        if (createPosPaymentDto.send_email_confirmation) {
          // TODO: Implement email confirmation
        }

        // Persisted discount snapshots — surface them on the response so the
        // POS confirmation modal can render promotion/coupon detail without
        // a separate roundtrip. The order detail page also returns these.
        const appliedPromotionsResponse = appliedPromotionDetails.map((p) => ({
          promotion_id: p.promotion_id,
          name: p.name,
          code: p.code,
          type: p.type,
          scope: p.scope,
          value: p.value,
          discount_amount: p.discount_amount,
        }));
        const appliedCouponsResponse =
          couponInfo.coupon_id && couponInfo.discount_amount > 0
            ? [
                {
                  coupon_id: couponInfo.coupon_id,
                  code: couponInfo.coupon_code,
                  discount_applied: couponInfo.discount_amount,
                },
              ]
            : [];

        // Plan KDS fire-flows (B5): refresh the in-memory `order`
        // so the response carries the post-payments state (e.g.
        // `processing` when the auto-fire created a kitchen
        // ticket; `finished` when there is no kitchen). The
        // pre-existing bug was that the response built the
        // `status` from the initial `order.state` snapshot taken
        // before `updateOrderPaymentStatus` ran, so the POS was
        // always told the order was `created` even when the BD
        // had moved it to `processing`.
        const refreshed = await tx.orders.findUnique({
          where: { id: order.id },
          select: { id: true, order_number: true, state: true },
        });
        if (refreshed) {
          order.state = refreshed.state;
        }

        return {
          success: true,
          message: isDigitalPayment
            ? 'Order created, processing payment...'
            : createPosPaymentDto.requires_payment
              ? 'Payment processed successfully'
              : 'Order created successfully (credit sale)',
          order: {
            id: order.id,
            order_number: order.order_number,
            status: order.state,
            payment_status: payment
              ? payment.state
              : isDigitalPayment
                ? 'pending'
                : 'pending',
            total_amount: order.grand_total,
            subtotal: order.subtotal_amount,
            tax_amount: order.tax_amount,
            discount_amount: order.discount_amount,
            shipping_cost: order.shipping_cost,
            applied_promotions: appliedPromotionsResponse,
            applied_coupons: appliedCouponsResponse,
          },
          // Plan KDS fire-flows (B9): surface the fire result so the POS
          // can show "X platos enviados a cocina" without a second
          // roundtrip. Null when no fire happened (non-restaurant store,
          // no prepared items, all skip_kds, etc).
          kitchen_fire: kitchenFireResult
            ? {
                fired_count: kitchenFireResult.firedItemSnapshots.length,
                kitchen_ticket_id: kitchenFireResult.ticketId,
                cogs_total: Number(
                  kitchenFireResult.cogsTotal.toFixed(4),
                ),
              }
            : null,
          applied_promotions: appliedPromotionsResponse,
          applied_coupons: appliedCouponsResponse,
          payment: payment
            ? {
                id: payment.id,
                amount: payment.amount,
                payment_method:
                  payment.store_payment_method?.display_name ||
                  payment.store_payment_method?.system_payment_method
                    ?.display_name ||
                  'Unknown',
                status: payment.status,
                transaction_id: payment.transaction_id,
                change: payment.change,
                nextAction: payment?.nextAction,
              }
            : undefined,
          nextAction: payment?.nextAction,
          _digitalPaymentPending: isDigitalPayment || false,
        };
      });

      // Plan KDS fire-flows (B5 / B9): AFTER the payment $transaction
      // commits, emit the kitchen.fired event + push the KDS SSE
      // snapshot for the auto-fire we just did. Failures here MUST NOT
      // roll back the payment: the order + payment + fire are
      // already persisted and visible to the kitchen via the
      // REST snapshot endpoint, so the operator can re-fetch.
      if (result.kitchen_fire && result.kitchen_fire.kitchen_ticket_id) {
        try {
          // We do not have `kitchenFireResult.cogsTotal` after commit;
          // the helper re-emits the same shape we built inside the
          // transaction. We pass the minimal info we DO have.
          await this.kitchenFireService.emitKitchenFiredAfterCommit(
            createPosPaymentDto.store_id,
            undefined,
            {
              ticketId: result.kitchen_fire.kitchen_ticket_id,
              firedItemSnapshots: [],
              cogsTotal: result.kitchen_fire.cogs_total || 0,
              consumedLineCount: 0,
            },
            result.order.id,
          );
        } catch (err) {
          this.logger.error(
            `Failed to emit kitchen.fired for ticket #${result.kitchen_fire.kitchen_ticket_id}: ${
              (err as Error).message
            }`,
            (err as Error).stack,
          );
        }
      }

      // Process digital payments AFTER transaction commit (order is now visible)
      if (result.success && result._digitalPaymentPending) {
        try {
          const payment = await this.processPosPaymentTransaction(
            this.prisma as any,
            {
              id: result.order.id,
              store_id: createPosPaymentDto.store_id,
              grand_total: result.order.total_amount,
            } as any,
            createPosPaymentDto,
          );
          if (payment) {
            result.payment = {
              id: payment.id,
              amount: payment.amount,
              payment_method:
                payment.store_payment_method?.display_name ||
                payment.store_payment_method?.system_payment_method
                  ?.display_name ||
                'Wompi',
              status: payment.state,
              transaction_id: payment.transaction_id,
              change: 0,
              nextAction: payment?.nextAction,
            };
            result.nextAction = payment?.nextAction;
            result.message = 'Payment initiated successfully';
          }
        } catch (err) {
          this.logger.error(
            `Digital payment processing failed: ${err.message}`,
            err.stack,
          );
          result.payment = { success: false, message: err.message };

          // Release stock reservations and revert order status so it can be retried or cancelled
          try {
            // Release stock reservations first
            await this.stockLevelManager.releaseReservationsByReference(
              'order',
              result.order.id,
              'cancelled',
            );
            // Then revert order state
            await this.prisma.orders.update({
              where: { id: result.order.id },
              data: { state: 'created', updated_at: new Date() },
            });
          } catch (revertErr) {
            this.logger.error(
              `Failed to revert order/stock: ${revertErr.message}`,
            );
          }
        }
        delete result._digitalPaymentPending;
      }

      // Drafts: short-circuit before any post-transaction side effects.
      // No cash movement, no installments, no invoice data request, no
      // success message tied to a sale.
      if (result.success && createPosPaymentDto.is_draft) {
        return {
          success: true,
          order: result.order,
          message: 'Draft saved successfully',
          _isDraft: true,
        };
      }

      // Record cash register movement AFTER transaction commit (non-critical)
      if (result.success) {
        this.recordCashRegisterMovement(
          createPosPaymentDto,
          result.order,
          result.payment,
          user,
        ).catch((err) => {
          this.logger.error(
            `Failed to record cash register movement: ${err.message}`,
            err.stack,
          );
        });

        // Create order installments for credit sales
        if (!createPosPaymentDto.requires_payment && result.order?.id) {
          this.createOrderInstallments(createPosPaymentDto, result.order).catch(
            (err) => {
              this.logger.error(
                `Failed to create order installments: ${err.message}`,
                err.stack,
              );
            },
          );
        }

        // Create invoice data request for anonymous/CF sales
        if (!createPosPaymentDto.customer_id && result.order?.id) {
          try {
            const invoiceDataRequest =
              await this.invoiceDataRequestsService.createRequest(
                createPosPaymentDto.store_id,
                Number(result.order.id),
              );
            result.order.invoice_data_token = invoiceDataRequest.token;
          } catch (err) {
            this.logger.error(
              `Failed to create invoice data request: ${err.message}`,
              err.stack,
            );
          }
        }
      }

      return result;
  }

  /**
   * Create order installments for credit sales (post-transaction)
   */
  private async createOrderInstallments(
    dto: CreatePosPaymentDto,
    order: { id: number | bigint; total_amount?: any },
  ) {
    const creditType = dto.credit_type || 'installments';
    const orderId =
      typeof order.id === 'object' ? Number(order.id) : Number(order.id);

    const updateData: Record<string, any> = {
      credit_type: creditType,
      remaining_balance: order.total_amount || 0,
      total_paid: 0,
    };

    if (dto.installment_terms) {
      const terms = dto.installment_terms;
      // Normalize interest rate: if > 1, treat as percentage (e.g., 12 → 0.12)
      const rawRate = terms.interest_rate || 0;
      const interestRate = rawRate > 1 ? rawRate / 100 : rawRate;
      const interestType = terms.interest_type || 'simple';

      if (interestRate > 0) {
        updateData.interest_rate = interestRate;
        updateData.interest_type = interestType;
      }

      if (creditType === 'installments') {
        const initialPayment = terms.initial_payment || 0;
        // Subtract initial payment from total BEFORE calculating installments
        const amountToFinance =
          Math.round((Number(order.total_amount) - initialPayment) * 100) / 100;

        const schedule = calculateSchedule({
          total_amount: amountToFinance,
          num_installments: terms.num_installments,
          frequency: terms.frequency,
          first_installment_date: new Date(terms.first_installment_date),
          interest_rate: interestRate,
          interest_type: interestType as 'simple' | 'compound',
        });

        const totalInstallments = schedule.reduce(
          (sum, item) => sum + item.installment_value,
          0,
        );
        // total_with_interest = initial payment + sum of all installments (which include interest on financed amount)
        updateData.total_with_interest =
          Math.round((initialPayment + totalInstallments) * 100) / 100;
        updateData.remaining_balance =
          Math.round(totalInstallments * 100) / 100;

        // Create installments (calculated on amount AFTER initial payment)
        for (const item of schedule) {
          await this.prisma.order_installments.create({
            data: {
              order_id: orderId,
              installment_number: item.installment_number,
              amount: item.installment_value,
              capital_amount: item.capital_value,
              interest_amount: item.interest_value,
              due_date: item.due_date,
              state: 'pending',
              amount_paid: 0,
              remaining_balance: item.installment_value,
            },
          });
        }

        // Register initial payment record if provided
        if (initialPayment > 0) {
          const transactionId = `pos_credit_init_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          await this.prisma.payments.create({
            data: {
              order_id: orderId,
              amount: initialPayment,
              currency: 'COP',
              state: 'succeeded',
              transaction_id: transactionId,
              paid_at: new Date(),
              store_payment_method_id: terms.initial_payment_method_id || null,
              gateway_response: {
                payment_type: 'direct',
                metadata: { is_initial_credit_payment: true },
              },
            },
          });

          updateData.total_paid = initialPayment;
          // remaining_balance already set to totalInstallments (excludes initial payment)
        }
      } else {
        // Free credit - just set interest fields if applicable
        if (interestRate > 0) {
          const totalInterest = Number(order.total_amount) * interestRate;
          updateData.total_with_interest =
            Math.round((Number(order.total_amount) + totalInterest) * 100) /
            100;
          updateData.remaining_balance = updateData.total_with_interest;
        }
      }
    }

    // Update the order with credit fields
    await this.prisma.orders.update({
      where: { id: orderId },
      data: updateData,
    });
  }

  private hasActivePermission(user: any, permissionName: string): boolean {
    const roles = user?.roles || [];
    if (roles.includes('super_admin') || roles.includes('SUPER_ADMIN')) {
      return true;
    }

    return (user?.permissions || []).some(
      (permission: any) =>
        permission?.name === permissionName && permission?.status === 'active',
    );
  }

  private requireActivePermission(user: any, permissionName: string): void {
    if (!this.hasActivePermission(user, permissionName)) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        'No tienes permiso para realizar esta operación en POS.',
      );
    }
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Recalculate promotional discounts for a POS sale using `PromotionEngineService.quoteDiscounts`.
   *
   * Backend is the source of truth: it ignores any `discount_amount` sent by
   * the frontend and only honours `promotion_ids` (manual promotions) plus
   * auto-applied promotions. Returns the full quote result including the
   * `order_promotions_snapshot` ready to persist 1 row per applied promotion.
   *
   * The cart items passed by POS already contain the catalog `final_unit_price`
   * (tax-inclusive). Promotions in Vendix operate on this same unit price,
   * matching the legacy behavior in `PromotionEngineService.validatePromotion`.
   */
  private async calculatePosPromotionQuote(
    dto: CreatePosPaymentDto,
  ): Promise<PromotionQuoteResult> {
    const input: PromotionQuoteInput = {
      customer_id: dto.customer_id ?? null,
      manual_promotion_ids: Array.isArray(dto.promotion_ids)
        ? dto.promotion_ids
        : [],
      items: (dto.items || [])
        .filter((item) => item.product_id)
        .map((item, index) => ({
          line_id: index,
          product_id: item.product_id as number,
          variant_id: item.product_variant_id ?? null,
          category_id: item.category_id ?? null,
          category_ids: item.category_ids ?? null,
          unit_price: Number(
            item.final_unit_price ?? item.unit_price ?? 0,
          ),
          quantity: Number(item.quantity || 0),
        })),
    };

    try {
      return await this.promotionEngine.quoteDiscounts(input);
    } catch (error) {
      this.logger.warn(
        `[POS] quoteDiscounts failed, falling back to no-discount: ${
          (error as Error).message
        }`,
      );
      const subtotal = input.items.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0,
      );
      return {
        subtotal: this.roundMoney(subtotal),
        total_discount: 0,
        promotional_subtotal: this.roundMoney(subtotal),
        applied_promotions: [],
        items: [],
        order_promotions_snapshot: [],
        tier_progress: [],
      };
    }
  }

  /**
   * Recalculate coupon discount server-side via `CouponsService.validate`.
   *
   * Coupons are independent of promotions: their discount stacks on top of the
   * promotional discount but is capped so the combined discount does not
   * exceed the items subtotal. Returns an object with the validated
   * coupon_id/code plus the recalculated `discount_amount` (0 if the coupon
   * is missing, invalid, or fails business rules — silent failure mirrors
   * the legacy behavior to avoid breaking POS sales due to coupon issues).
   */
  private async calculatePosCouponDiscount(
    dto: CreatePosPaymentDto,
    productsSubtotal: number,
    promotionsDiscount: number,
  ): Promise<{
    coupon_id: number | null;
    coupon_code: string | null;
    discount_amount: number;
  }> {
    const code = (dto.coupon_code || '').trim();
    if (!code) {
      return { coupon_id: null, coupon_code: null, discount_amount: 0 };
    }

    try {
      const remainingSubtotal = Math.max(
        0,
        this.roundMoney(productsSubtotal - promotionsDiscount),
      );
      const cartItems = (dto.items || [])
        .filter((item) => item.product_id)
        .map((item) => {
          const unitPrice = Number(item.final_unit_price ?? item.unit_price ?? 0);
          return {
            product_id: item.product_id as number,
            category_id: item.category_id,
            category_ids: item.category_ids,
            line_total: this.roundMoney(unitPrice * Number(item.quantity || 0)),
          };
        });

      const validation = await this.couponsService.validate({
        code,
        cart_subtotal: remainingSubtotal,
        customer_id: dto.customer_id,
        items: cartItems,
      } as any);

      const discount = this.roundMoney(
        Math.min(validation.discount_amount || 0, remainingSubtotal),
      );

      return {
        coupon_id: validation.coupon_id,
        coupon_code: validation.code,
        discount_amount: discount,
      };
    } catch (error) {
      this.logger.warn(
        `[POS] Coupon validation failed for code="${code}": ${
          (error as Error).message
        }`,
      );
      return { coupon_id: null, coupon_code: null, discount_amount: 0 };
    }
  }

  private roundRate(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100000) / 100000;
  }

  private getPosLineUnits(item: any): number {
    const weight = Number(item.weight || 0);
    if (weight > 0) return weight;
    return Number(item.quantity || 0);
  }

  private resolveRequestedFinalUnitPrice(
    item: any,
    lineUnits: number,
    fallbackFinalUnitPrice: number,
  ): number {
    if (item.final_unit_price !== undefined && item.final_unit_price !== null) {
      return this.roundMoney(Number(item.final_unit_price));
    }

    if (
      item.total_price !== undefined &&
      item.total_price !== null &&
      lineUnits > 0
    ) {
      return this.roundMoney(Number(item.total_price) / lineUnits);
    }

    return this.roundMoney(fallbackFinalUnitPrice);
  }

  private resolveCatalogUnitBasePrice(product: any, variant?: any): number {
    const productBase = Number(product.base_price || 0);

    if (
      variant?.is_on_sale &&
      variant.sale_price != null &&
      Number(variant.sale_price) > 0
    ) {
      return Number(variant.sale_price);
    }

    if (variant?.price_override != null && Number(variant.price_override) > 0) {
      return Number(variant.price_override);
    }

    if (
      product.is_on_sale &&
      product.sale_price != null &&
      Number(product.sale_price) > 0
    ) {
      return Number(product.sale_price);
    }

    return productBase;
  }

  private async calculateTaxCategoryTaxes(
    tx: any,
    taxCategoryId: number | undefined,
    basePrice: number,
    storeId: number,
  ): Promise<{
    total_rate: number;
    total_tax_amount: number;
    taxes: { tax_rate_id: number; name: string; rate: number; amount: number }[];
  }> {
    if (!taxCategoryId) {
      return { total_rate: 0, total_tax_amount: 0, taxes: [] };
    }

    const store = await tx.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    const organizationId =
      store?.organization_id ??
      RequestContextService.getContext()?.organization_id;

    const scopeOptions: any[] = [{ store_id: storeId }];
    if (organizationId) {
      scopeOptions.push({ organization_id: organizationId, store_id: null });
    }

    const taxCategory = await tx.tax_categories.findFirst({
      where: {
        id: taxCategoryId,
        OR: scopeOptions,
      },
      include: { tax_rates: true },
    });

    if (!taxCategory) {
      throw new BadRequestException(
        'La categoría de impuesto seleccionada no existe para esta tienda.',
      );
    }

    const taxes = (taxCategory.tax_rates || []).map((rate: any) => {
      const rateValue = Number(rate.rate || 0);
      return {
        tax_rate_id: rate.id,
        name: rate.name,
        rate: rateValue,
        amount: basePrice * rateValue,
      };
    });
    const totalRate = taxes.reduce((sum, tax) => sum + tax.rate, 0);

    return {
      total_rate: totalRate,
      total_tax_amount: basePrice * totalRate,
      taxes,
    };
  }

  /**
   * Multi-tarifa (Fase 5.5): resuelve snapshots por línea POS.
   *
   * Patrón espejo de `OrdersService.resolveTierSnapshotsForItems`:
   * - Si NINGUNA línea trae `applied_price_tier_id`, retorna `[]` (no overhead).
   * - Si AL MENOS UNA línea lo trae, valida server-side el permission
   *   `store:products:apply_pricing_tier`. Bypass para super_admin / owner.
   *   Si denegado, lanza `VendixHttpException(PRICING_TIER_PERMISSION_DENIED)`.
   * - Pre-carga tarifas (price_tiers.units_per_package) y los overrides por
   *   producto (product_price_tier_overrides.override_units_per_package) para
   *   computar `stock_units_consumed` siguiendo la cascada de packSize
   *   (override ?? tier ?? 1). Si packSize <= 1, no hay empaque y el snapshot
   *   queda en null.
   * - Lenient: si la tarifa no existe en esta tienda, snapshot = null (no
   *   crashea la venta).
   *
   * Devuelve un array alineado por índice con `items`.
   */
  private async resolveTierSnapshotsForItems(
    tx: any,
    items: Array<{
      product_id?: number;
      product_variant_id?: number | null;
      quantity: number;
      applied_price_tier_id?: number;
    }>,
    context: ReturnType<typeof RequestContextService.getContext>,
  ): Promise<Array<PosTierSnapshot | null>> {
    const tierIdsInUse = new Set<number>();
    for (const item of items) {
      if (
        item.applied_price_tier_id !== undefined &&
        item.applied_price_tier_id !== null
      ) {
        tierIdsInUse.add(Number(item.applied_price_tier_id));
      }
    }

    if (tierIdsInUse.size === 0) {
      return items.map(() => null);
    }

    // Permission gate (server-side; UI cannot bypass).
    const permissions = context?.permissions ?? [];
    const isSuperAdmin = !!context?.is_super_admin;
    const isOwner = !!context?.is_owner;
    if (
      !isSuperAdmin &&
      !isOwner &&
      !permissions.includes('store:products:apply_pricing_tier')
    ) {
      throw new VendixHttpException(ErrorCodes.PRICING_TIER_PERMISSION_DENIED);
    }

    const tiers = await tx.price_tiers.findMany({
      where: { id: { in: Array.from(tierIdsInUse) }, is_active: true },
      select: {
        id: true,
        name: true,
        is_package_unit: true,
        units_per_package: true,
        discount_percentage: true,
      },
    });
    type TierRow = (typeof tiers)[number];
    const tierById = new Map<number, TierRow>(
      tiers.map((t: TierRow): [number, TierRow] => [t.id, t]),
    );

    const productIds = Array.from(
      new Set(items.map((i) => i.product_id).filter((id): id is number => !!id)),
    );
    const assignments = productIds.length
      ? await tx.product_price_tier_assignments.findMany({
          where: {
            product_id: { in: productIds },
            price_tier_id: { in: Array.from(tierIdsInUse) },
          },
          select: { product_id: true, price_tier_id: true },
        })
      : [];
    const allowedTierKeys = new Set(
      assignments.map(
        (assignment: { product_id: number; price_tier_id: number }) =>
          `${assignment.product_id}:${assignment.price_tier_id}`,
      ),
    );

    // Per-product packaging overrides (override_units_per_package wins over
    // tier.units_per_package in the packSize cascade). Keyed by
    // product_id:variant_id:price_tier_id (variant null → "null").
    const overrides = productIds.length
      ? await tx.product_price_tier_overrides.findMany({
          where: {
            product_id: { in: productIds },
            price_tier_id: { in: Array.from(tierIdsInUse) },
          },
          select: {
            product_id: true,
            variant_id: true,
            price_tier_id: true,
            override_price: true,
            override_units_per_package: true,
          },
        })
      : [];
    type OverrideInfo = {
      override_price: number | null;
      override_units_per_package: number | null;
    };
    const overrideByKey = new Map<string, OverrideInfo>(
      overrides.map(
        (o: {
          product_id: number;
          variant_id: number | null;
          price_tier_id: number;
          override_price: number | null;
          override_units_per_package: number | null;
        }): [string, OverrideInfo] => [
          `${o.product_id}:${o.variant_id ?? 'null'}:${o.price_tier_id}`,
          {
            override_price:
              o.override_price != null ? Number(o.override_price) : null,
            override_units_per_package: o.override_units_per_package,
          },
        ],
      ),
    );

    return items.map((item) => {
      const tierId = item.applied_price_tier_id;
      if (tierId === undefined || tierId === null) return null;
      const tier = tierById.get(Number(tierId));
      if (!tier) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
      }
      const productId = item.product_id;
      if (!productId || !allowedTierKeys.has(`${productId}:${Number(tierId)}`)) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
      }
      const variantId = item.product_variant_id ?? null;
      const override = overrideByKey.get(
        `${productId}:${variantId ?? 'null'}:${Number(tierId)}`,
      );
      const override_units_per_package =
        override?.override_units_per_package ?? null;
      const stock_units_consumed = resolveStockUnitsConsumed(
        Number(item.quantity),
        tier?.units_per_package,
        override_units_per_package,
      );
      return {
        tier_id: tier.id,
        tier_name: tier.name,
        stock_units_consumed,
        discount_percentage: Number(tier.discount_percentage ?? 0),
        units_per_package: tier.units_per_package ?? null,
        is_package_unit: !!tier.is_package_unit,
        override_price: override?.override_price ?? null,
        override_units_per_package,
      };
    });
  }

  private async buildPosOrderItem(
    tx: any,
    item: any,
    dtoStoreId: number,
    user: any,
    tierSnap?: PosTierSnapshot | null,
  ): Promise<any> {
    const isCustomItem = item.item_type === 'custom' || !item.product_id;
    const lineUnits = this.getPosLineUnits(item);

    if (lineUnits <= 0) {
      throw new BadRequestException('La cantidad del ítem debe ser mayor a 0.');
    }

    if (isCustomItem) {
      this.requireActivePermission(user, 'store:pos:custom_items:create');

      const productName = (item.product_name || '').trim();
      if (!productName) {
        throw new BadRequestException(
          'El ítem personalizado requiere un nombre o descripción.',
        );
      }

      const rateProbe = await this.calculateTaxCategoryTaxes(
        tx,
        item.tax_category_id,
        1,
        dtoStoreId,
      );
      const finalUnitPrice = this.resolveRequestedFinalUnitPrice(
        item,
        lineUnits,
        Number(item.unit_price || 0) * (1 + rateProbe.total_rate),
      );
      const unitBasePrice =
        rateProbe.total_rate > 0
          ? finalUnitPrice / (1 + rateProbe.total_rate)
          : finalUnitPrice;
      const taxInfo = await this.calculateTaxCategoryTaxes(
        tx,
        item.tax_category_id,
        unitBasePrice,
        dtoStoreId,
      );

      return this.buildOrderItemSnapshot({
        item,
        productName,
        sku: item.product_sku,
        description: item.description || item.notes,
        itemType: 'custom',
        quantity: item.quantity,
        lineUnits,
        unitBasePrice,
        finalUnitPrice,
        taxInfo,
        costPrice: null,
        catalogUnitPrice: null,
        catalogFinalPrice: null,
        isPriceOverridden: false,
        priceOverrideReason: undefined,
        priceOverriddenByUserId: undefined,
        productId: undefined,
        productVariantId: undefined,
        tierSnap: tierSnap ?? null,
      });
    }

    const product = await tx.products.findFirst({
      where: {
        id: item.product_id,
        store_id: dtoStoreId,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        is_on_sale: true,
        sale_price: true,
        product_type: true,
        allow_pos_price_override: true,
      },
    });

    if (!product) {
      throw new BadRequestException('Producto no encontrado para esta tienda.');
    }

    const variant = item.product_variant_id
      ? await tx.product_variants.findFirst({
          where: {
            id: item.product_variant_id,
            product_id: product.id,
          },
          select: {
            id: true,
            sku: true,
            price_override: true,
            is_on_sale: true,
            sale_price: true,
          },
        })
      : null;

    if (item.product_variant_id && !variant) {
      throw new BadRequestException('La variante no pertenece al producto.');
    }

    // Multi-tarifa (Fase 5.5): cuando la línea trae una tarifa válida (ya
    // verificada por `resolveTierSnapshotsForItems`), el precio esperado del
    // catálogo ES el precio de la tarifa (override_price o
    // base * packSize * (1 - descuento/100)) — NO el precio base unitario.
    // Sin esto, el chequeo de override manual interpreta la tarifa como una
    // edición de precio y bloquea la venta ("no permite editar el precio en
    // POS"). Reusa el resolver canónico para mantener una sola fuente de verdad
    // con el cálculo del frontend y de orders/quotations.
    const tierBaseUnitPrice = tierSnap
      ? this.priceResolverService.resolveWithTier({
          product: {
            base_price: Number(product.base_price || 0),
            is_on_sale: !!product.is_on_sale,
            sale_price:
              product.sale_price != null ? Number(product.sale_price) : null,
            track_inventory: true,
            // Snapshot validado ⇒ la tarifa aplica; forzamos el cálculo de
            // tarifa en vez de depender del flag (posiblemente desincronizado).
            has_multiple_price_tiers: true,
          },
          variant: variant
            ? {
                price_override:
                  variant.price_override != null
                    ? Number(variant.price_override)
                    : null,
                is_on_sale: !!variant.is_on_sale,
                sale_price:
                  variant.sale_price != null
                    ? Number(variant.sale_price)
                    : null,
                track_inventory_override: null,
              }
            : undefined,
          priceTier: {
            id: tierSnap.tier_id,
            name: tierSnap.tier_name,
            discount_percentage: tierSnap.discount_percentage,
            is_package_unit: tierSnap.is_package_unit,
            units_per_package: tierSnap.units_per_package,
          },
          tierOverrides: [
            {
              variant_id: item.product_variant_id ?? null,
              override_price: tierSnap.override_price,
              override_units_per_package: tierSnap.override_units_per_package,
            },
          ],
          taxRate: 0,
        }).unitPrice
      : this.resolveCatalogUnitBasePrice(product, variant);
    const catalogUnitPrice = this.roundMoney(tierBaseUnitPrice);
    const catalogTaxInfo = await this.taxes_service.calculateProductTaxes(
      product.id,
      catalogUnitPrice,
    );
    const catalogFinalPrice = this.roundMoney(
      catalogUnitPrice + catalogTaxInfo.total_tax_amount,
    );
    const finalUnitPrice = this.resolveRequestedFinalUnitPrice(
      item,
      lineUnits,
      catalogFinalPrice,
    );
    const isPriceOverridden =
      Math.abs(finalUnitPrice - catalogFinalPrice) >= 0.01;

    if (isPriceOverridden) {
      if (!product.allow_pos_price_override) {
        throw new BadRequestException(
          `El producto "${product.name}" no permite editar el precio en POS.`,
        );
      }
      this.requireActivePermission(user, 'store:pos:price_override');
    }

    const unitBasePrice =
      catalogTaxInfo.total_rate > 0
        ? finalUnitPrice / (1 + catalogTaxInfo.total_rate)
        : finalUnitPrice;
    const taxInfo = await this.taxes_service.calculateProductTaxes(
      product.id,
      unitBasePrice,
    );
    const costPrice = await resolveCostPrice(
      tx,
      product.id,
      item.product_variant_id,
    );

    return this.buildOrderItemSnapshot({
      item,
      productName: item.product_name || product.name,
      sku: item.product_sku || variant?.sku || product.sku,
      description: item.description || item.notes,
      itemType: product.product_type === 'service' ? 'service' : 'physical',
      quantity: item.quantity,
      lineUnits,
      unitBasePrice,
      finalUnitPrice,
      taxInfo,
      costPrice,
      catalogUnitPrice,
      catalogFinalPrice,
      isPriceOverridden,
      priceOverrideReason: isPriceOverridden
        ? item.price_override_reason
        : undefined,
      priceOverriddenByUserId: isPriceOverridden ? user?.id : undefined,
      productId: product.id,
      productVariantId: item.product_variant_id,
      tierSnap: tierSnap ?? null,
    });
  }

  private buildOrderItemSnapshot(params: {
    item: any;
    productName: string;
    sku?: string | null;
    description?: string;
    itemType: string;
    quantity: number;
    lineUnits: number;
    unitBasePrice: number;
    finalUnitPrice: number;
    taxInfo: {
      total_rate: number;
      total_tax_amount: number;
      taxes: {
        tax_rate_id: number;
        name: string;
        rate: number;
        amount: number;
        tax_type?: string;
      }[];
    };
    costPrice: number | null;
    catalogUnitPrice: number | null;
    catalogFinalPrice: number | null;
    isPriceOverridden: boolean;
    priceOverrideReason?: string;
    priceOverriddenByUserId?: number;
    productId?: number;
    productVariantId?: number;
    // Multi-tarifa snapshot (Fase 5.5). Resuelto previamente por
    // `resolveTierSnapshotsForItems` y alineado por índice con `dto.items`.
    tierSnap?: PosTierSnapshot | null;
  }): any {
    const lineBaseTotal = this.roundMoney(
      params.unitBasePrice * params.lineUnits,
    );
    const lineTaxTotal = this.roundMoney(
      params.taxInfo.total_tax_amount * params.lineUnits,
    );
    const isWeightedLine = Number(params.item.weight || 0) > 0;
    const itemTaxAmount = isWeightedLine
      ? lineTaxTotal
      : this.roundMoney(params.taxInfo.total_tax_amount);

    const orderItem: any = {
      product_name: params.productName,
      description: params.description,
      variant_sku: params.sku || undefined,
      variant_attributes: params.item.variant_attributes
        ? JSON.stringify(params.item.variant_attributes)
        : undefined,
      quantity: params.quantity,
      unit_price: this.roundMoney(params.unitBasePrice),
      total_price: lineBaseTotal,
      tax_rate: this.roundRate(params.taxInfo.total_rate),
      tax_amount_item: itemTaxAmount,
      cost_price: params.costPrice,
      catalog_unit_price:
        params.catalogUnitPrice === null
          ? undefined
          : this.roundMoney(params.catalogUnitPrice),
      catalog_final_price:
        params.catalogFinalPrice === null
          ? undefined
          : this.roundMoney(params.catalogFinalPrice),
      final_unit_price: this.roundMoney(params.finalUnitPrice),
      is_price_overridden: params.isPriceOverridden,
      price_override_reason: params.priceOverrideReason || undefined,
      price_overridden_by_user_id: params.priceOverriddenByUserId || undefined,
      weight: params.item.weight || undefined,
      weight_unit: params.item.weight_unit || undefined,
      item_type: params.itemType,
      // Multi-tarifa (Fase 5.5): snapshot persistente. `null` cuando la línea
      // no tenía applied_price_tier_id o cuando la tarifa no existe en esta
      // tienda (fallback lenient, mismo patrón que OrdersService).
      //
      // NOTA: `applied_price_tier_id` es FK scalar. En nested-create dentro de
      // `orders.create({ data: { order_items: { create: [...] } } })`, Prisma
      // usa el variant *Checked* y rechaza el scalar FK directo — exige la
      // relación. Por eso lo asignamos abajo como `applied_price_tier: { connect }`.
      applied_price_tier_name_snapshot: params.tierSnap?.tier_name ?? null,
      stock_units_consumed: params.tierSnap?.stock_units_consumed ?? null,
      // Plan KDS fire-flows: persistir la marca de "usar stock" del cajero.
      // Solo aplica a líneas `product_type='prepared'`; para el resto se
      // ignora. Default false para preservar el comportamiento retail.
      skip_kds: !!params.item.skip_kds,
    };

    if (params.tierSnap?.tier_id != null) {
      orderItem.applied_price_tier = {
        connect: { id: params.tierSnap.tier_id },
      };
    }

    if (params.productId) {
      orderItem.products = { connect: { id: params.productId } };
    }

    if (params.productVariantId) {
      orderItem.product_variants = {
        connect: { id: params.productVariantId },
      };
    }

    if (params.taxInfo.taxes.length > 0) {
      orderItem.order_item_taxes = {
        create: params.taxInfo.taxes.map((tax) => ({
          tax_rate_id: tax.tax_rate_id,
          tax_name: tax.name,
          tax_rate: this.roundRate(tax.rate),
          tax_amount: this.roundMoney(tax.amount * params.lineUnits),
          tax_type: tax.tax_type ?? 'iva',
          is_compound: false,
        })),
      };
    }

    return orderItem;
  }

  /**
   * Create or update order from POS data
   */
  /**
   * Bug 1 / Obj 4 (Fase K): apply a POS payment to an already-open
   * `table_sessions` row. Loads the session's draft order, appends the
   * POS items as `order_items`, recalculates totals, and returns the
   * order so the rest of `processPosPayment` (payments, inventory,
   * COGS, journal entries) reuses the same flow as a fresh sale.
   *
   * Validation:
   *  - The session must belong to the current store.
   *  - The session must be open (no `closed_at`).
   *  - The bound order must exist and be in a payable state (`draft` or
   *    `created`).
   */
  private async applyPosPaymentToTableSession(
    tx: any,
    dto: CreatePosPaymentDto,
    user: any,
    dtoStoreId: number,
  ): Promise<{
    order: any;
    // QUI-431 — alineado con la rama de venta fresca (`createOrUpdateOrderFromPos`)
    // para que el caller lea la misma forma; aquí solo se calcula sobre las
    // líneas nuevas que el DTO añadió al cierre de mesa.
    hasSerialized: boolean;
    promotionsSnapshot: any[];
    appliedPromotions: any[];
    couponInfo: { coupon_id: number | null; coupon_code: string | null; discount_amount: number };
    // Plan KDS fire-flows (B6): the auto-fire result captured inside the
    // table close-out, so the caller (`processPosPayment`) can surface it
    // in the response (`kitchen_fire`), flip `hasKitchenItems`, and emit
    // the `kitchen.fired` event + KDS SSE push AFTER the payment commit.
    // Null when nothing was fired (non-restaurant store, no prepared items,
    // all already consumed, all skip_kds).
    kitchenFire: {
      ticketId: number;
      firedItemSnapshots: Array<{
        orderItemId: number;
        productId: number;
        productName: string;
        quantity: number;
      }>;
      cogsTotal: number;
      consumedLineCount: number;
    } | null;
  }> {
    const tableSessionId = dto.table_session_id!;

    const session = await tx.table_sessions.findUnique({
      where: { id: tableSessionId },
      include: { order: true },
    });
    if (!session) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_NOT_FOUND,
        'Sesión de mesa no encontrada',
      );
    }
    if (session.store_id !== dtoStoreId) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'La mesa pertenece a otra tienda',
      );
    }
    if (session.closed_at != null) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ALREADY_OPEN,
        'La mesa ya está cerrada',
      );
    }
    if (!session.order) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_NOT_FOUND,
        'La sesión de mesa no tiene una orden vinculada',
      );
    }

    // Same multi-tarifa validation as the regular path. `dto.items`
    // is optional when a table session is being closed out — the items
    // already live on the draft order. We only validate tiers when the
    // caller actually sent items, to keep the close-out path
    // dependency-free.
    const context = RequestContextService.getContext();
    const tierSnapshots =
      dto.items && dto.items.length > 0
        ? await this.resolveTierSnapshotsForItems(tx, dto.items, context)
        : [];

    // Build the new order_items from the POS payload (if any).
    const newItems =
      dto.items && dto.items.length > 0
        ? await Promise.all(
            dto.items.map((item, index) =>
              this.buildPosOrderItem(
                tx,
                item,
                dtoStoreId,
                user,
                tierSnapshots[index],
              ),
            ),
          )
        : [];

    // Re-derive totals from the (now augmented) order. We re-fetch the
    // order with its current items to compute the new sums in one pass.
    const existingItems = await tx.order_items.findMany({
      where: { order_id: session.order_id },
    });
    const mergedItems = [...existingItems, ...newItems];

    const newSubtotal = this.roundMoney(
      mergedItems.reduce(
        (sum, item) => sum + Number(item.total_price || 0),
        0,
      ),
    );
    const newTax = this.roundMoney(
      mergedItems.reduce((sum, item) => {
        const nestedTaxes = (item as any).order_item_taxes ?? [];
        if (Array.isArray(nestedTaxes) && nestedTaxes.length > 0) {
          return (
            sum +
            nestedTaxes.reduce(
              (taxSum: number, tax: any) =>
                taxSum + Number(tax.tax_amount || 0),
              0,
            )
          );
        }
        const multiplier =
          Number((item as any).weight || 0) > 0
            ? 1
            : Number(item.quantity || 1);
        return sum + Number(item.tax_amount_item || 0) * multiplier;
      }, 0),
    );
    const shippingCost = this.roundMoney(dto.shipping_cost || 0);
    // GAP-6 — Propina del cierre de mesa. Aditiva al grand_total, SIN IVA:
    // NO se suma a subtotal_amount ni tax_amount (no es ingreso ni base
    // gravable). Se persiste aparte en orders.tip_amount y la contabilidad
    // la reconoce como pasivo custodio (propinas por pagar).
    const tip = this.roundMoney(dto.tip_amount || 0);
    // Re-evaluate promotions + coupons over the merged subtotal so the
    // final total stays consistent with the fresh path.
    const promotionQuote = await this.calculatePosPromotionQuote(dto);
    const couponInfo = await this.calculatePosCouponDiscount(
      dto,
      newSubtotal,
      promotionQuote.total_discount,
    );
    const totalDiscount = this.roundMoney(
      promotionQuote.total_discount + couponInfo.discount_amount,
    );
    const grandTotal = this.roundMoney(
      Math.max(0, newSubtotal + newTax - totalDiscount + shippingCost + tip),
    );

    // Persist new items + totals on the session's order. Customer is
    // updated here (in case the picker was changed) but only when one is
    // provided; an anonymous sale keeps the existing customer_id.
    const updated = await tx.orders.update({
      where: { id: session.order_id },
      data: {
        ...(dto.customer_id != null ? { customer_id: dto.customer_id } : {}),
        ...(newItems.length > 0
          ? { order_items: { create: newItems } }
          : {}),
        subtotal_amount: newSubtotal,
        tax_amount: newTax,
        discount_amount: totalDiscount,
        grand_total: grandTotal,
        shipping_cost: shippingCost,
        // GAP-6 — propina persistida aparte (no entra a subtotal/tax).
        tip_amount: tip,
        updated_at: new Date(),
        // The table's own order already carries `channel=pos` from the
        // session creation; we keep that and just refresh totals.
      },
      include: { order_items: true, stores: true },
    });

    // ----------------------------------------------------------------
    // Plan KDS fire-flows (B6): auto-fire the pending `prepared` items
    // of the table's draft order to the kitchen BEFORE the session is
    // closed. Same core as B5 (`processPosPayment`) and B7
    // (`split-order.service`): resolve the fireable order_item_ids
    // (prepared + active recipe handled inside `prepareFireContext` +
    // `inventory_consumed_at_fire=false` + NOT skip_kds — including the
    // items just appended in this close-out), then call
    // `prepareFireContext` + `fireOrderItemsInTx` INSIDE the same
    // $transaction so the flag flip + leaf-stock consumption +
    // kitchen_ticket create are atomic with the order/session write.
    //
    // The deferred `kitchen.fired` event + KDS SSE push run AFTER the
    // payment $transaction commits, from `processPosPayment` (which
    // owns the commit boundary and calls `emitKitchenFiredAfterCommit`).
    //
    // Anti-double-fire: once these items are flagged
    // `inventory_consumed_at_fire=true`, the B5 block in
    // `processPosPayment` re-reads candidates with that flag = false and
    // finds nothing, so it becomes a no-op. The same flag keeps
    // `updateInventoryFromOrder` from re-discounting at payment.
    let kitchenFire:
      | {
          ticketId: number;
          firedItemSnapshots: Array<{
            orderItemId: number;
            productId: number;
            productName: string;
            quantity: number;
          }>;
          cogsTotal: number;
          consumedLineCount: number;
        }
      | null = null;
    if (storeIsRestaurant((updated as any).stores?.industries)) {
      const fireableItems = await tx.order_items.findMany({
        where: {
          order_id: session.order_id,
          skip_kds: false,
          product_id: { not: null },
          inventory_consumed_at_fire: false,
          products: { product_type: 'prepared' },
        },
        select: { id: true },
      });
      const candidateIds = fireableItems.map((i) => i.id);
      if (candidateIds.length > 0) {
        // Pass `tx` so the catalog reads (recipes, BOM, default
        // locations) and the just-appended order_items are visible on
        // the SAME connection as the order write (mirrors B5).
        const ctx = await this.kitchenFireService.prepareFireContext(
          session.order_id,
          candidateIds,
          tx,
        );
        if (ctx && ctx.firedItemIds.length > 0) {
          kitchenFire = await this.kitchenFireService.fireOrderItemsInTx(
            tx,
            dtoStoreId,
            ctx,
          );
        }
      }
    }

    // Close the table session so the table flips back to its terminal
    // status. The order itself is left in `created` so the rest of the
    // POS payment pipeline (payments row, inventory, journal) runs as
    // usual; the table just stops accumulating new items.
    //
    // We also transition the table row to `cleaning` to match the canonical
    // close path in `TableSessionsService.closeSession`. Without this the
    // `tables.status` would stay `occupied` after a POS close-out, which
    // is misleading to staff (the seat is free, but the next cashier sees the
    // table as still occupied) and can race with the next `openTableSession`
    // call on the same table.
    await tx.table_sessions.update({
      where: { id: session.id },
      data: { closed_at: new Date() },
    });
    await tx.tables.update({
      where: { id: session.table_id },
      data: { status: 'cleaning', updated_at: new Date() },
    });

    // QUI-431 — detección de serializados sobre TODAS las líneas del pedido de
    // la mesa (las que ya vivían en el draft + las nuevas del cierre), no solo
    // `dto.items`. Un serializado agregado en cualquier momento de la sesión
    // debe disparar el desvío a remisión; si solo miráramos las líneas del
    // cierre, una unidad serializada del draft se consumiría por FIFO silencioso
    // en lugar de diferirse. `updated.order_items` es el set persistido tras el
    // merge (incluye viejas + nuevas con IDs reales).
    const hasSerialized = await this.orderHasSerializedItems(
      tx,
      ((updated as any).order_items ?? []).map((i: any) => ({
        product_id: i.product_id,
      })) as PosOrderItemDto[],
    );

    return {
      order: updated,
      hasSerialized,
      promotionsSnapshot: promotionQuote.order_promotions_snapshot ?? [],
      appliedPromotions: promotionQuote.applied_promotions ?? [],
      couponInfo,
      kitchenFire,
    };
  }

  private async createOrUpdateOrderFromPos(
    tx: any,
    dto: CreatePosPaymentDto,
    user: any,
  ) {
    // store_id is guaranteed by processPosPayment (line ~612) which copies it
    // from RequestContext. Re-assert here so downstream typing is non-null and
    // we fail fast with a domain error if the invariant ever breaks.
    if (dto.store_id == null) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const dtoStoreId: number = dto.store_id;

    // Bug 1 / Obj 4 (Fase K): when the cashier opened/selected a table
    // from the inline picker in `pos-payment-interface`, the payment must
    // be applied to the existing draft order bound to that table session
    // instead of creating a brand-new order. Otherwise the table would
    // end up with two orders (the session's draft + the POS payment
    // order) and the cashier would have to reconcile them by hand.
    if (dto.table_session_id != null) {
      return await this.applyPosPaymentToTableSession(
        tx,
        dto,
        user,
        dtoStoreId,
      );
    }

    // Venta normal (sin sesión de mesa): los ítems son obligatorios para
    // construir la orden. `dto.items` es opcional a nivel de DTO solo para
    // soportar el cierre de mesa (manejado arriba), así que lo estrechamos
    // aquí antes de usarlo en `resolveTierSnapshotsForItems` y el map.
    const items = dto.items;
    if (!items || items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.PAY_VALIDATE_001,
        'Una venta POS requiere al menos un ítem.',
        { reason: 'items_required' },
      );
    }

    // QUI-431 — ¿Hay productos serializados en esta venta? Se computa UNA vez
    // ANTES de crear la orden porque condiciona el delivery_type persistido
    // (abajo). Se retorna al caller (`processPosPayment`) para reutilizarlo en
    // el gate de inventario y la máquina de estados sin re-consultar la BD.
    const hasSerialized = await this.orderHasSerializedItems(tx, items);

    let retries = 3;
    let orderNumber: string;

    // Multi-tarifa (Fase 5.5): si alguna línea trae applied_price_tier_id,
    // validar permiso server-side ANTES de armar items. Patrón espejo de
    // OrdersService.resolveTierSnapshotsForItems.
    const context = RequestContextService.getContext();
    const tierSnapshots = await this.resolveTierSnapshotsForItems(
      tx,
      items,
      context,
    );

    while (retries > 0) {
      try {
        // Generate order number for this store
        orderNumber = await this.generateOrderNumber(tx, dtoStoreId);

        // Create order items from backend-normalized financial snapshots.
        const orderItems = await Promise.all(
          items.map((item, index) =>
            this.buildPosOrderItem(
              tx,
              item,
              dtoStoreId,
              user,
              tierSnapshots[index],
            ),
          ),
        );

        const calculatedSubtotal = this.roundMoney(
          orderItems.reduce(
            (sum, item) => sum + Number(item.total_price || 0),
            0,
          ),
        );
        const calculatedTaxAmount = this.roundMoney(
          orderItems.reduce((sum, item) => {
            const nestedTaxes = item.order_item_taxes?.create || [];
            if (nestedTaxes.length > 0) {
              return (
                sum +
                nestedTaxes.reduce(
                  (taxSum: number, tax: any) =>
                    taxSum + Number(tax.tax_amount || 0),
                  0,
                )
              );
            }

            const multiplier =
              Number(item.weight || 0) > 0 ? 1 : Number(item.quantity || 1);
            return sum + Number(item.tax_amount_item || 0) * multiplier;
          }, 0),
        );

        // Backend is the source of truth for promotion and coupon discounts.
        // Any `dto.discount_amount` sent by the frontend is intentionally
        // ignored for final totals — it is only kept by the frontend as a
        // local estimate and is recalculated here via `quoteDiscounts` +
        // CouponsService.
        const promotionQuote = await this.calculatePosPromotionQuote(dto);
        const couponInfo = await this.calculatePosCouponDiscount(
          dto,
          calculatedSubtotal,
          promotionQuote.total_discount,
        );

        const totalDiscount = this.roundMoney(
          promotionQuote.total_discount + couponInfo.discount_amount,
        );
        const shippingCost = this.roundMoney(dto.shipping_cost || 0);
        const grandTotal = this.roundMoney(
          Math.max(
            0,
            calculatedSubtotal +
              calculatedTaxAmount -
              totalDiscount +
              shippingCost,
          ),
        );

        // Build order data - only include customer_id if provided (for anonymous sales)
        // Initial state is 'created' - state transitions handled by OrderFlowService.
        // Drafts use state='draft' and payment_form=null so they don't get classified
        // as credit sales by downstream consumers (e.g., reports, listings).
        const orderData: any = {
          store_id: dto.store_id,
          order_number: orderNumber,
          state: dto.is_draft ? 'draft' : 'created',
          channel: 'pos', // POS orders are assigned 'pos' channel
          subtotal_amount: calculatedSubtotal,
          tax_amount: calculatedTaxAmount,
          discount_amount: totalDiscount,
          grand_total: grandTotal,
          currency: dto.currency,
          coupon_id: couponInfo.coupon_id ?? dto.coupon_id ?? undefined,
          coupon_code: couponInfo.coupon_code ?? dto.coupon_code ?? undefined,
          billing_address_id: dto.billing_address_id,
          shipping_address_id: dto.shipping_address_id,
          internal_notes: dto.internal_notes,
          notes: dto.notes,
          // Shipping fields (for delivery orders)
          // QUI-431 — Una venta con productos serializados NO se entrega al
          // instante en el mostrador: el serial concreto se registra después en
          // una remisión. Por eso se difiere a fulfillment. `home_delivery` se
          // respeta tal cual (ya es un flujo diferido con su propia logística);
          // cualquier otro tipo (direct_delivery / pickup / other) con
          // serializado se fuerza a `pickup`, porque pickup ES elegible para
          // remisión y direct_delivery NO lo es.
          delivery_type: hasSerialized
            ? (dto.delivery_type === 'home_delivery'
                ? 'home_delivery'
                : 'pickup')
            : dto.delivery_type || 'direct_delivery',
          payment_form: dto.is_draft
            ? null
            : dto.payment_form || (dto.requires_payment ? '1' : '2'),
          shipping_cost: shippingCost,
          shipping_address_snapshot: dto.shipping_address_snapshot || undefined,
          order_items: {
            create: orderItems,
          },
        };

        // Set shipping method if provided
        if (dto.shipping_method_id) {
          orderData.shipping_method_id = dto.shipping_method_id;
        }

        // Only include customer_id if provided (for anonymous sales, this will be undefined/null)
        if (dto.customer_id !== undefined && dto.customer_id !== null) {
          orderData.customer_id = dto.customer_id;
        }

        // Create the order
        const order = await tx.orders.create({
          data: orderData,
          include: {
            order_items: true,
            stores: true,
          },
        });

        // Link pending bookings to this order
        if (dto.booking_ids?.length) {
          await tx.bookings.updateMany({
            where: {
              id: { in: dto.booking_ids },
              store_id: dto.store_id,
              order_id: null,
              status: { in: ['pending', 'confirmed'] },
            },
            data: {
              order_id: order.id,
              updated_at: new Date(),
            },
          });
        }

        return {
          order,
          // QUI-431 — se propaga al caller para reutilizar la detección de
          // serializados en el gate de inventario y la máquina de estados.
          hasSerialized,
          promotionsSnapshot: promotionQuote.order_promotions_snapshot,
          appliedPromotions: promotionQuote.applied_promotions,
          couponInfo,
          // Plan KDS fire-flows (B6): the fresh-sale path does NOT fire here;
          // its auto-fire runs later in `processPosPayment` (B5). Keep the
          // shape aligned with the table close-out branch so the caller can
          // read `kitchenFire` uniformly.
          kitchenFire: null as null | {
            ticketId: number;
            firedItemSnapshots: Array<{
              orderItemId: number;
              productId: number;
              productName: string;
              quantity: number;
            }>;
            cogsTotal: number;
            consumedLineCount: number;
          },
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('order_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'Failed to generate unique POS order number after multiple attempts',
              );
            }
            // Retry with new order number
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Process payment transaction for POS
   */
  private async processPosPaymentTransaction(
    tx: any,
    order: any,
    dto: CreatePosPaymentDto,
  ) {
    // store_id is guaranteed by processPosPayment (resolved from RequestContext).
    // Re-assert here so PaymentGateway gets a non-null storeId.
    if (dto.store_id == null) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const dtoStoreId: number = dto.store_id;
    const payableAmount = this.roundMoney(
      Number(order?.grand_total ?? order?.total_amount ?? dto.total_amount ?? 0),
    );

    // Get payment method details
    if (!dto.store_payment_method_id) {
      throw new Error('Payment method is required when payment is enabled');
    }

    const paymentMethod = await tx.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: {
        system_payment_method: true,
      },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    // Check if method requires gateway processing (digital/async methods)
    const methodType = paymentMethod.system_payment_method.type;
    const digitalMethods = ['wompi', 'wallet'];

    if (digitalMethods.includes(methodType)) {
      // Decrypt credentials before passing to gateway processor
      const decryptedConfig = this.paymentEncryption.decryptConfig(
        (paymentMethod.custom_config || {}) as Record<string, any>,
        methodType,
      );

      // Delegate to PaymentGateway for async/digital methods
      const gatewayResult = await this.paymentGateway.processPayment({
        orderId: order.id,
        customerId: dto.customer_id,
        amount: payableAmount,
        currency: dto.currency || 'COP',
        storePaymentMethodId: dto.store_payment_method_id,
        storeId: dtoStoreId,
        // Back-compat: POS does not yet expose an idempotency key on the DTO.
        // Initialize a fresh UUID per attempt; if the operator retries the
        // POS action the system creates a NEW order anyway (different orderId),
        // so duplicate-charge risk is bounded.
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          paymentMethod: dto.wompi_payment_method,
          wompiConfig: decryptedConfig,
          walletId: dto.wallet_id,
          customerEmail: dto.customer_email,
          is_pos_payment: true,
        },
        returnUrl: dto.return_url,
      });

      // Gateway already created the payment record, fetch it
      const payment = await tx.payments.findFirst({
        where: { order_id: order.id },
        orderBy: { created_at: 'desc' },
        include: {
          store_payment_method: {
            include: { system_payment_method: true },
          },
        },
      });

      if (payment) {
        payment.nextAction = gatewayResult.nextAction;
        payment.change = 0;
      }

      return payment;
    }

    // Direct methods (cash, card, bank_transfer) - existing flow continues below
    // Calculate change for cash payments
    let change = 0;
    const amountReceived =
      dto.amount_received !== undefined && dto.amount_received !== null
        ? Number(dto.amount_received)
        : payableAmount;
    if (paymentMethod.system_payment_method.type === 'cash') {
      if (amountReceived < payableAmount) {
        throw new BadRequestException(
          'El monto recibido no puede ser menor al total de la orden.',
        );
      }
      change = this.roundMoney(amountReceived - payableAmount);
    }

    // Create payment record
    const payment = await tx.payments.create({
      data: {
        order_id: order.id,
        store_payment_method_id: dto.store_payment_method_id,
        amount: payableAmount,
        currency: dto.currency,
        state: 'succeeded',
        transaction_id: await this.generateTransactionId(),
        gateway_response: {
          reference: dto.payment_reference,
          change: change,
          metadata: {
            register_id: dto.register_id,
            seller_user_id: dto.seller_user_id,
            amount_received: amountReceived,
            is_pos_payment: true,
          },
        },
      },
      include: {
        store_payment_method: {
          include: {
            system_payment_method: true,
          },
        },
      },
    });

    // GAP-2 — Saneamiento del balance de la orden SOLO para métodos directos
    // (cash/card/bank_transfer) recién creados como `succeeded`. La rama digital
    // (wompi/wallet) retorna antes (arriba) porque nace `pending`; su balance se
    // confirma en otro flujo. `payableAmount` == `payment.amount` (== grand_total
    // ya finalizado, con propina/envío incluidos porque `createOrUpdateOrderFromPos`
    // /`applyPosPaymentToTableSession` ya escribieron grand_total ANTES de este
    // punto). El helper re-lee grand_total fresco dentro del `tx`.
    await this.applyOrderBalanceOnPayment(tx, order.id, payableAmount);

    return payment;
  }

  /**
   * GAP-2 — Persiste `orders.total_paid` y `orders.remaining_balance` tras un
   * pago. Réplica del patrón canónico de `OrderFlowService` (order-flow.service.ts:
   * newTotalPaid = total_paid + paidAmount; remaining = max(grand_total -
   * newTotalPaid, 0)), leyendo grand_total + total_paid FRESCOS dentro del mismo
   * `tx` para ver el grand_total ya finalizado (propina incluida en cierre de mesa).
   *
   * Saneamiento puro: ningún auto-entry lee `orders.total_paid` (el asiento usa
   * `payment.amount`), por lo que esta escritura NO tiene efecto contable.
   */
  private async applyOrderBalanceOnPayment(
    tx: any,
    orderId: number,
    paidAmount: number,
  ): Promise<void> {
    const order = await tx.orders.findUnique({
      where: { id: orderId },
      select: { grand_total: true, total_paid: true },
    });
    if (!order) return;
    const grandTotal = Number(order.grand_total || 0);
    const newTotalPaid = Number(order.total_paid || 0) + Number(paidAmount || 0);
    const remainingBalance = Math.max(grandTotal - newTotalPaid, 0);
    await tx.orders.update({
      where: { id: orderId },
      data: {
        total_paid: Math.round(newTotalPaid * 100) / 100,
        remaining_balance: Math.round(remainingBalance * 100) / 100,
      },
    });
  }

  /**
   * Update order payment status for POS transactions
   * For POS direct delivery with payment: created -> finished (immediate sale)
   * For POS home delivery with payment: created -> processing (needs shipping)
   * For POS without payment (credit sale): stays in 'created'
   */
  /**
   * F2-guard helper — true when the order still has kitchen items the cook
   * has not handed off (`kitchen_ticket_items.status NOT IN
   * ('delivered','cancelled')`). Mirrors `OrderFlowService.hasPendingKitchenItems`
   * but runs on the payment `$transaction` client so it sees uncommitted
   * writes from this same POS payment. Scope-safe: `kitchen_ticket_items` is
   * auto-scoped through `kitchen_ticket.store_id` in StorePrismaService, and
   * we further constrain by `kitchen_ticket.order_id`.
   */
  private async hasPendingKitchenItemsTx(
    tx: any,
    orderId: number,
  ): Promise<boolean> {
    const pendingCount = await tx.kitchen_ticket_items.count({
      where: {
        kitchen_ticket: { order_id: orderId },
        status: { notIn: ['delivered', 'cancelled'] },
      },
    });
    return pendingCount > 0;
  }

  private async updateOrderPaymentStatus(
    tx: any,
    orderId: number,
    paymentState: string,
    deferToFulfillment = false,
    hasKitchenItems = false,
  ) {
    let orderState: string;
    const additionalData: any = { updated_at: new Date() };

    switch (paymentState) {
      case 'succeeded':
        if (hasKitchenItems) {
          // Restaurant POS — paid but NOT finished. The order stays in
          // `processing` ("pagada / en cocina") until the KDS delivers every
          // kitchen ticket (or the 4h auto-finish job runs). We intentionally
          // do NOT set `completed_at` here: the sale is paid but the lifecycle
          // is still open (cocina pendiente).
          orderState = 'processing';
        } else if (deferToFulfillment) {
          // QUI-431 — la entrega se difiere a una etapa posterior de
          // fulfillment (despacho a domicilio O producto serializado que se
          // registra en una remisión). Pagada pero NO terminada: queda en
          // `processing` sin `completed_at`. Esta rama consolida el antiguo
          // caso exclusivo de `home_delivery`; el caller decide la condición
          // (`order.delivery_type === 'home_delivery' || hasSerialized`).
          orderState = 'processing';
        } else if (await this.hasPendingKitchenItemsTx(tx, orderId)) {
          // F2-guard (POS payment, AUTOMATIC path): defensive backstop.
          // `hasKitchenItems` is normally TRUE whenever the auto-fire
          // (B5/B6) created a ticket BEFORE this call, so the first branch
          // already routes those orders to `processing`. But if for any
          // reason the discriminator is FALSE while the order still has
          // undelivered kitchen_ticket_items (e.g. ordering races, a
          // ticket created out of band), we must NOT finish the order.
          // Force `processing` instead of `finished`. We do NOT throw here
          // — throwing would roll back the whole payment.
          this.logger.log(
            `Order #${orderId} paid but kept in 'processing': undelivered kitchen items detected (F2-guard).`,
          );
          orderState = 'processing';
        } else {
          // Direct POS sale — finished immediately
          orderState = 'finished';
          additionalData.completed_at = new Date();
        }
        break;
      case 'pending_payment':
        orderState = 'pending_payment';
        break;
      case 'pending':
        orderState = 'created';
        break;
      case 'failed':
        orderState = 'created';
        break;
      case 'refunded':
        orderState = 'refunded';
        additionalData.completed_at = new Date();
        break;
      default:
        orderState = 'created';
    }

    await tx.orders.update({
      where: { id: orderId },
      data: {
        state: orderState,
        ...additionalData,
      },
    });
  }

  /**
   * Deduct stock for a delivered/finished POS order by delegating to the
   * canonical `OrderStockCommitService.commitOrderDelivery`.
   *
   * That service runs, per line, the single uniform pipeline shared by every
   * delivery path: skips (service / !track_inventory / inventory_consumed_at_fire
   * / restaurant-prepared-pending), reservation consume (releaseReservation),
   * availability validation that BLOCKS with INV_STOCK_002 on insufficient stock
   * (blockOnInsufficient), serial consumption, the single net `updateStock`
   * ('sale'), and marking `order_items.inventory_committed` — then a defensive
   * sweep of residual active reservations.
   *
   * Serial correlation (QUI-431): the raw POS DTO lines are passed straight
   * through as `posSelection`; the service matches them to each order line
   * claim-once by (product_id, variant_id) to resolve the operator-chosen
   * serials, falling back to FIFO auto-selection for lines with no manual
   * selection (ecommerce / credit / other channels pass no `posItems`).
   *
   * Runs with the caller's payment `tx`, so a stock BLOCK rolls the entire
   * payment back atomically.
   */
  private async updateInventoryFromOrder(
    tx: any,
    order: any,
    posItems?: PosOrderItemDto[],
  ): Promise<CommitResult> {
    return this.orderStockCommit.commitOrderDelivery(
      order.id,
      {
        movementType: 'sale',
        blockOnInsufficient: true,
        consumeSerials: true,
        reason: 'POS Sale',
        userId: order.created_by ?? RequestContextService.getUserId?.(),
        posSelection: posItems,
      },
      tx,
    );
  }

  /**
   * QUI-431 — ¿La venta POS incluye al menos un producto serializado?
   *
   * Una sola query batch sobre los product_id de las líneas del DTO contra
   * `products.requires_serial_numbers` (el flag es a nivel de PRODUCTO, no de
   * variante). Se computa UNA vez (antes de crear la orden) y se reutiliza en
   * el forzado de delivery_type, el gate de inventario y la máquina de estados.
   *
   * Las líneas sin product_id (productos custom) se ignoran. Devuelve false
   * cuando no hay product_ids o ninguno requiere seriales.
   */
  private async orderHasSerializedItems(
    tx: any,
    posItems?: PosOrderItemDto[],
  ): Promise<boolean> {
    const productIds = Array.from(
      new Set(
        (posItems ?? [])
          .map((i) => i.product_id)
          .filter((id): id is number => id != null),
      ),
    );
    if (productIds.length === 0) return false;

    const found = await tx.products.findMany({
      where: { id: { in: productIds }, requires_serial_numbers: true },
      select: { id: true },
    });
    return found.length > 0;
  }

  /**
   * Generate unique order number per store
   */
  private async generateOrderNumber(tx: any, storeId: number): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const prefix = `POS-${year}`;

    // Find the last order number for this store and year
    const lastOrder = await tx.orders.findFirst({
      where: {
        store_id: storeId,
        order_number: {
          startsWith: prefix,
        },
      },
      orderBy: {
        order_number: 'desc',
      },
      select: { order_number: true },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.split('-')[2]);
      sequence = lastSequence + 1;
    }

    return `${prefix}-${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Generate unique transaction ID
   */
  private async generateTransactionId(): Promise<string> {
    return `POS-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  private async getUserStoreIds(user: any): Promise<number[]> {
    const storeUsers = await this.prisma.store_users.findMany({
      where: { user_id: user.id },
      select: { store_id: true },
    });

    return storeUsers.map((su: any) => su.store_id);
  }

  /**
   * Get payment methods for a store
   */
  async getStorePaymentMethods(storeId: number, user: any) {
    // Use standardized validation method
    await this.validateUserAccess(user, storeId);

    return this.prisma.store_payment_methods.findMany({
      where: {
        store_id: storeId,
        state: 'enabled',
      },
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /**
   * Create payment method for a store
   * @deprecated Use StorePaymentMethodsService.enableForStore instead
   */
  async createStorePaymentMethod(
    storeId: number,
    createPaymentMethodDto: any,
    user: any,
  ) {
    // Use standardized validation method
    await this.validateUserAccess(user, storeId);

    // This method is deprecated - use StorePaymentMethodsService.enableForStore instead
    throw new BadRequestException(
      'Creating payment methods directly is deprecated. Use POST /stores/:storeId/payment-methods/enable/:systemMethodId instead',
    );
  }

  /**
   * Record a cash register movement when the feature is enabled.
   * Silently skips if feature is disabled or no active session exists.
   */
  private async recordCashRegisterMovement(
    dto: CreatePosPaymentDto,
    order: any,
    payment: any,
    user: any,
  ) {
    try {
      // store_id is guaranteed by processPosPayment which copies it from
      // RequestContext before any downstream call. Re-assert here so the
      // cash-register movement is never recorded against a null store.
      if (dto.store_id == null) {
        throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
      }
      const dtoStoreId: number = dto.store_id;

      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      this.logger.debug(
        `[CashRegister] cr_settings.enabled=${cr_settings?.enabled}`,
      );
      if (!cr_settings?.enabled) return;

      // Find active session for this user
      const session = await this.sessionsService.getActiveSession(user.id);
      this.logger.debug(
        `[CashRegister] Active session for user ${user.id}: ${session ? `id=${session.id}` : 'NONE'}`,
      );
      if (!session) return;

      const order_id = order?.id;
      const payment_id = payment?.id;
      const amount = Number(payment?.amount || order?.total_amount || 0);
      this.logger.debug(
        `[CashRegister] order_id=${order_id}, payment_id=${payment_id}, amount=${amount}`,
      );
      if (!order_id || amount <= 0) return;

      // Resolve the actual system payment method type (cash, card, etc.)
      // payment.payment_method contains the display_name, not the system type
      let payment_method = 'cash';
      if (dto.store_payment_method_id) {
        const method = await this.prisma.store_payment_methods.findFirst({
          where: { id: dto.store_payment_method_id },
          include: { system_payment_method: { select: { type: true } } },
        });
        payment_method = method?.system_payment_method?.type || 'cash';
      }

      this.logger.debug(
        `[CashRegister] payment_method=${payment_method}, track_non_cash=${cr_settings.track_non_cash_payments}`,
      );

      // Only track non-cash if setting enabled
      if (payment_method !== 'cash' && !cr_settings.track_non_cash_payments) {
        this.logger.debug(
          `[CashRegister] Skipping non-cash movement (tracking disabled)`,
        );
        return;
      }

      await this.movementsService.recordSaleMovement(session.id, {
        store_id: dtoStoreId,
        user_id: user.id,
        amount,
        payment_method,
        order_id,
        payment_id,
      });
      this.logger.log(
        `[CashRegister] Sale movement recorded for session ${session.id}, order ${order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `[CashRegister] Error recording movement: ${error.message}`,
        error.stack,
      );
    }
  }
}
