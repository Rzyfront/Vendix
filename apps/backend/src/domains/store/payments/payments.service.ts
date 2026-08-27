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
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
import { sellableStockLevelsWhere } from '../inventory/shared/helpers/pos-stock-scope.helper';
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
import {
  resolveTierSnapshotsForItems,
  type TierSnapshot,
} from '../products/services/tier-snapshot.util';
import {
  resolvePriceUnitScale,
  resolvePriceUnits,
} from '../products/services/price-unit.util';
import { resolvePackSize } from '../products/services/packaging.util';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { calculateSchedule } from '../orders/utils/installment-schedule-calculator';
import { pickCostPrice } from '../orders/utils/resolve-cost-price';
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
// Sólo el CONTRATO del evento fiscal del POS: un tipo y una constante, sin
// servicios. Así el cobro anuncia la venta sin depender del módulo de
// facturación — la emisión vive del otro lado del `emit`.
import {
  POS_SALE_COMPLETED_EVENT,
  PosSaleCompletedEvent,
} from '../invoicing/pos/pos-sale-completed.event';
import { DEFAULT_POS_AUTO_EMIT } from '../settings/interfaces/store-settings.interface';
import { WompiClientFactory } from './processors/wompi/wompi.factory';
import { WompiProcessor } from './processors/wompi/wompi.processor';
import { WompiEnvironment } from './processors/wompi/wompi.types';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { RequestContextService } from '@common/context/request-context.service';
import { WithholdingFlowService } from '../withholding-tax/withholding-flow.service';
import type { WithholdingResolution } from '../withholding-tax/withholding-flow.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import { SerialNumberEnforcementService } from '../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../inventory/serial-numbers/inventory-serial-numbers.service';
import { FiscalInvoiceThresholdService } from '@common/services/fiscal-invoice-threshold.service';
import {
  AuditService,
  AuditResource,
} from '@common/audit/audit.service';

/**
 * Multi-tarifa (Fase 5.5): snapshot por línea POS. Lleva tanto el dato
 * persistente (tier_id/tier_name/stock_units_consumed) como los insumos de
 * precio (discount_percentage, packaging, override_price) necesarios para
 * recomputar server-side el precio esperado de la tarifa vía
 * `PriceResolverService.resolveWithTier` y así validar el override manual
 * contra el precio de tarifa — no contra el precio base del catálogo.
 */
/**
 * El snapshot POS es el contrato canónico de `tier-snapshot.util`. Se mantiene
 * el alias local porque el resto del servicio lo referencia por este nombre.
 */
type PosTierSnapshot = TierSnapshot;

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
    // QUI-559: spreads a POS line's reservation across the store's sellable
    // locations, so a quantity covered only by summing warehouses is reserved
    // (and later deducted) instead of being refused.
    private readonly sellableStockAllocator: SellableStockAllocator,
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
    // Restaurant Suite — POS table close-out emits `session_closed` post-commit
    // (reuses the canonical emitter on TableSessionsService).
    private readonly tableSessionsService: TableSessionsService,
    // QUI-431 — serial-number pool + enforcement (no-op for non-serialized
    // products, so they can be invoked unconditionally on the sale path).
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serialNumbers: InventorySerialNumbersService,
    // Art. 616-1 ET / Res. 000165/2023 — frontera 5 UVT entre documento
    // equivalente POS y factura electrónica nominativa.
    private readonly fiscalInvoiceThreshold: FiscalInvoiceThresholdService,
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · audit emission for `order.draft_saved`.
    // Only used in the draft short-circuit (no other behavior change). Wired
    // here because `@Global()` AuditModule already exports it, so DI resolves
    // without touching the module wiring.
    private readonly auditService: AuditService,
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

      // ----------------------------------------------------------------
      // CP-POS-CREAR-EDITAR-COBRAR-001 — B.2 draft/payment invariant.
      //
      // `is_draft=true` significa "guardar la orden pendiente de cobro". Combinarlo
      // con `requires_payment=true` es contradictorio: si la intención es cobrar,
      // NO debe ser draft; si la intención es guardar, NO debe procesar pago.
      // Se valida ANTES de la `$transaction` para no tomar numeración ni abrir
      // un cupón/COGS/inventario/pago que luego haya que revertir.
      // ----------------------------------------------------------------
      if (
        createPosPaymentDto.is_draft === true &&
        createPosPaymentDto.requires_payment === true
      ) {
        throw new VendixHttpException(
          ErrorCodes.POS_DRAFT_REQUIRES_PAYMENT_001,
          'A draft (is_draft=true) cannot be combined with requires_payment=true; save the order first, then charge it via flow/pay',
        );
      }

      // ----------------------------------------------------------------
      // CP-POS-CREAR-EDITAR-COBRAR-001 — B.1 customer gate.
      //
      // Política canónica: `settings.checkout.require_customer_data=true` (default).
      // Una orden POS sin cliente queda huérfana y no se puede cobrar, facturar ni
      // atender soporte. La validación corre en backend, ANTES de abrir la
      // `$transaction`, para no escribir pagos / cupones / eventos / COGS / inventario
      // / invoice sobre una orden sin identificar.
      //
      // El default seguro es TRUE: si la rama `checkout` no existe en settings
      // (settings legacy, JSON parcial), se trata como `require_customer_data=true`
      // y se exige cliente. Sólo se omite el gate cuando el flag es EXPLÍCITAMENTE
      // `false`, política opt-in del comerciante.
      //
      // Escape hatch POS-side: cuando `settings.pos.allow_anonymous_sales=true`
      // (flag operativo del cajero, distinto de `checkout.require_customer_data`
      // que gobierna la facturación electrónica), el operador puede hacer ventas
      // sin cliente desde el POS. El cashier decide desde el modal de selección
      // de cliente (Venta Anónima vs. Con Cliente); el frontend clona el cart
      // sin `customer_id` cuando selecciona anónimo. Sólo aplica a POS; el
      // ecommerce mantiene `checkout.require_customer_data` como autoridad.
      //
      // Cuando hay `customer_id`, se valida que el cliente pertenezca a la tienda
      // del contexto vía `store_users` (manual scope — el getter `users` del
      // `StorePrismaService` devuelve el `baseClient` sin scope; el join se hace
      // por la tabla de membresía).
      // ----------------------------------------------------------------
      const checkoutSettings = (settings as any)?.checkout as
        | { require_customer_data?: boolean }
        | undefined;
      const requireCustomerData =
        checkoutSettings?.require_customer_data !== false;

      const posSettings = (settings as any)?.pos as
        | { allow_anonymous_sales?: boolean }
        | undefined;
      const allowAnonymousSales = posSettings?.allow_anonymous_sales === true;

      if (requireCustomerData && !allowAnonymousSales) {
        const customerId = createPosPaymentDto.customer_id;
        const customerIdInvalid =
          customerId === undefined ||
          customerId === null ||
          (typeof customerId === 'number' &&
            (!Number.isInteger(customerId) || customerId < 1));

        if (customerIdInvalid) {
          throw new VendixHttpException(
            ErrorCodes.POS_CUSTOMER_REQUIRED_001,
            'POS order requires a valid customer_id when checkout.require_customer_data is enabled',
            { reason: 'missing_or_invalid_customer_id' },
          );
        }

        // Scope-safe lookup: `users` no está scopeado por `StorePrismaService`
        // (su getter devuelve el `baseClient`); validamos la membresía con
        // `store_users.findFirst({ where: { store_id, user_id } })` antes de
        // aceptar el cliente en esta tienda.
        const membership = await this.prisma.store_users.findFirst({
          where: {
            store_id: createPosPaymentDto.store_id,
            user_id: customerId as number,
          },
          select: { user_id: true },
        });
        if (!membership) {
          throw new VendixHttpException(
            ErrorCodes.POS_CUSTOMER_REQUIRED_001,
            'POS customer does not belong to the current store',
            { reason: 'customer_store_mismatch' },
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

        // Frontera 5 UVT (Art. 616-1 ET / Res. 000165 de 2023): una venta
        // anónima por encima de 5 UVT no puede soportarse con el documento
        // equivalente POS — exige factura electrónica, y para emitirla hay que
        // identificar al adquiriente.
        //
        // Se evalúa AQUÍ, dentro de la transacción y contra el `grand_total`
        // recalculado por el servidor, por dos razones: (1) el total del DTO es
        // sugerido y el backend lo recalcula con promociones/cupones, así que
        // validar el del cliente permitiría declarar menos para pasar el umbral;
        // (2) un throw en este punto revierte la transacción completa, mientras
        // que validar después del commit dejaría la venta cerrada y sólo
        // corregible con nota crédito.
        //
        // QUI-673 — la organización SALE DE LA RELACIÓN, no de una columna.
        // `orders` no tiene `organization_id` (schema.prisma: sólo `store_id` +
        // la relación `stores`), así que `order.organization_id` valía SIEMPRE
        // `undefined`. TypeScript no lo veía porque `order` está tipado `any` en
        // las dos ramas que lo producen. Con `undefined`, la cadena
        // `assertInvoiceNotRequired` → `FiscalGateService.isAreaEnabled` →
        // `getFiscalScope` reventaba dentro de Prisma, el gate capturaba el
        // error y fallaba CERRADO devolviendo `false` con un WARN: el umbral no
        // se evaluaba en NINGUNA venta POS y el cobro respondía 201 normal.
        //
        // Ambas ramas que producen `order` traen `stores` en su `include`
        // (`createOrUpdateOrderFromPos` y `applyPosPaymentToTableSession`), así
        // que la relación resuelve la organización sin una consulta extra
        // dentro de la transacción. El contexto de request queda sólo como red
        // de seguridad, igual que en `calculateTaxCategoryTaxes`.
        await this.fiscalInvoiceThreshold.assertInvoiceNotRequired({
          organization_id:
            order.stores?.organization_id ?? context?.organization_id,
          store_id: order.store_id ?? createPosPaymentDto.store_id ?? null,
          total_amount: order.grand_total ?? 0,
          has_customer: Boolean(createPosPaymentDto.customer_id),
          channel: 'pos',
        });

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

        // CP-POS-SVC-PERF-001 / A.4 — pure drafts (Guardar borrador) must NOT
        // touch stock_levels or stock_reservations. The cashier reserves at
        // flow/pay when actually charging. Forcing drafts through the
        // reservation path was the dominant cost of the slow-Guardar bug.
        if (createPosPaymentDto.is_draft) {
          // §1.5 + §1.6 of stock validation/reservation are skipped entirely.
        } else {

        // 1.5. BLOCKING stock validation using stock_levels (source of truth)
        // Validate ALL items before any reservation occurs
        // Oversell is intentionally not controlled by the public POS payload.
        const allowOversell = false;

        // `track_inventory` es el mismo valor para los dos bucles de stock y
        // para toda la transacción, así que consultarlo por ítem —dos veces por
        // ítem, una en cada bucle— no aportaba aislamiento, solo latencia
        // dentro de la ventana transaccional (causa medida del P2028). Un
        // prefetch único, siguiendo el patrón batch de
        // `resolveTierSnapshotsForItems`.
        // `track_inventory` es `Boolean @default(true)` no nulable en el schema.
        type StockProductRow = {
          id: number;
          track_inventory: boolean;
          name: string;
        };
        const stockProductIds = Array.from(
          new Set(
            (order.order_items as Array<{ product_id?: number | null }>)
              .map((orderItem) => orderItem.product_id)
              .filter((id): id is number => !!id),
          ),
        );
        const stockProductById = new Map<number, StockProductRow>(
          (stockProductIds.length
            ? await tx.products.findMany({
                where: { id: { in: stockProductIds } },
                select: { id: true, track_inventory: true, name: true },
              })
            : []
          ).map((row: StockProductRow): [number, StockProductRow] => [
            row.id,
            row,
          ]),
        );

        for (const item of order.order_items) {
          if (!item.product_id) continue;

          const product = stockProductById.get(item.product_id);

          if (!product?.track_inventory) continue;

          // Get actual available stock from stock_levels table (source of truth)
          // Aggregate across store-local, sellable locations only.
          // POS canal MUST exclude central warehouse and non-sellable types
          // (quarantine / damaged_goods) per Plan §6.4.3 + regla 17/19.
          //
          // QUI-559: the predicate is no longer written inline here — it comes
          // from `sellableStockLevelsWhere`, the same helper that drives what
          // the POS grid displays and what the delivery commit may deduct.
          // Three copies of this filter is how they drifted apart.
          const stockAggregate = await tx.stock_levels.aggregate({
            where: {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              ...sellableStockLevelsWhere(order.store_id),
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

        // QUI-559: no "default location" fallback here any more. Picking an
        // arbitrary location when the product had no row there is what let a
        // reservation land somewhere the commit would not draw from. The
        // allocator resolves the real sellable locations; if none covers the
        // line, that is a stock error, not a location-resolution problem.
        for (const item of order.order_items) {
          if (!item.product_id) continue;

          const product = stockProductById.get(item.product_id);
          if (!product?.track_inventory) continue;
          try {
            // Use savepoint to isolate stock reservation errors from the main transaction.
            // PostgreSQL aborts the entire transaction on any error; a savepoint lets us
            // catch and rollback just the failed operation while keeping the transaction alive.
            await tx.$executeRawUnsafe('SAVEPOINT stock_reserve_sp');

            // Multi-tarifa (Fase 5.5): si el item persistió stock_units_consumed
            // (>0), pasarlo como override al reservador para descontar la
            // cantidad real de unidades de stock (empaque por tarifa, cuando el
            // packSize resuelto de la tarifa/override es > 1).
            const stockUnitsConsumed =
              typeof item.stock_units_consumed === 'number' &&
              item.stock_units_consumed > 0
                ? item.stock_units_consumed
                : undefined;
            const unitsToReserve = stockUnitsConsumed ?? item.quantity;

            // QUI-559: reserve ACROSS the store's sellable locations instead of
            // picking the single one with the highest availability. The
            // validation above approved an aggregate total; reserving from one
            // location could only ever cover part of it, and the delivery
            // commit then refused the sale with INV_STOCK_002 ("disponible 8,
            // requerido 10") even though the 10 units existed and were
            // sellable — merely split between two warehouses.
            const allocation =
              await this.sellableStockAllocator.allocateForLine(
                order.store_id,
                item.product_id,
                item.product_variant_id || undefined,
                unitsToReserve,
                [],
                tx,
              );

            if (allocation.shortfall > 0) {
              // §1.5 already proved the sellable set covers this line, so a gap
              // here means another sale took the units in between. That is a
              // real, user-facing condition — not an infrastructure hiccup — so
              // it aborts the payment instead of leaving the order partially
              // reserved and failing later at the delivery commit.
              throw new VendixHttpException(
                ErrorCodes.POS_STOCK_INSUFFICIENT_001,
                `Stock insuficiente al reservar el producto ${item.product_id}: requiere ${unitsToReserve} unidades, disponible ${allocation.available}.`,
              );
            }

            if (!allocation.slices.length) {
              // Nothing to reserve (a zero-unit line). Nothing to roll back
              // either — release the savepoint and move on.
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT stock_reserve_sp');
              continue;
            }

            for (const slice of allocation.slices) {
              await this.stockLevelManager.reserveStock(
                item.product_id,
                item.product_variant_id || undefined,
                slice.location_id,
                slice.quantity,
                'order',
                order.id,
                user?.id,
                false, // Already validated above against stock_levels source of truth.
                tx,
                undefined, // expires_at
                false, // skip_reservation
                // The slice quantity IS the real stock-unit count: the pack
                // multiplier was already applied when computing unitsToReserve.
                slice.quantity,
              );
            }

            await tx.$executeRawUnsafe('RELEASE SAVEPOINT stock_reserve_sp');
          } catch (error) {
            // Rollback to savepoint to recover the transaction from PostgreSQL's aborted state
            try {
              await tx.$executeRawUnsafe(
                'ROLLBACK TO SAVEPOINT stock_reserve_sp',
              );
            } catch {}

            // QUI-559: a stock error is a business answer, not an incident.
            // Swallowing it here let the payment succeed with the line
            // unreserved, and the delivery commit then rejected the whole sale
            // with an opaque INV_STOCK_002. Re-throw so the cashier gets the
            // real reason and the transaction rolls back cleanly; genuine
            // infrastructure hiccups keep the previous tolerant behaviour.
            if (error instanceof VendixHttpException) {
              throw error;
            }

            this.logger.warn(
              `Stock reservation failed for product ${item.product_id} in order #${order.id}: ${error.message}`,
            );
          }
        }

        } // end A.4 is_draft skip

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
        const isDigitalPayment = await this.isDeferredDigitalMethod(
          tx,
          createPosPaymentDto,
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


        if (isDirectDeliveryFinished) {
          // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR F19.
          // The `update_inventory` flag was a client-side bypass: a
          // tampered / stale client could send `false` and the server
          // would silently skip the stock move for a direct-delivery
          // finished sale, leaving the books out of sync with reality.
          // The branch is now driven ONLY by `isDirectDeliveryFinished`
          // (a server-owned predicate: requires_payment + non-home +
          // non-serialized), so the inventory move is invariant.
          //
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
              // Sin `client` las 6 lecturas de la cadena salen por una segunda
              // conexión del pool mientras esta transacción sostiene locks.
              client: tx,
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
              // Plan Despacho Economía — FASE 4 paso 15. Ingreso de flete
              // separado en cuenta 414505 al pagar un POS directo con flete.
              shipping_amount: Number(order.shipping_cost || 0),
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
              // `client: tx` es lo que ata estas filas a la venta. Sin él se
              // confirmaban por su cuenta y un rollback posterior (p.ej. el
              // `coupon_uses.create` de más abajo violando su unique) revertía la
              // orden dejando retenciones huérfanas.
              client: tx,
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
              // Plan Despacho Economía — FASE 4 paso 15. Crédito con flete →
              // se reconoce también ingreso de flete en cuenta 414505.
              shipping_amount: Number(order.shipping_cost || 0),
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
              // Misma razón que en la rama de pago inmediato: la retención de una
              // venta a crédito no puede sobrevivir al rollback de esa venta.
              client: tx,
            });
          }
        }

        // 5d. Register coupon use from the server-recalculated coupon
        // discount. The frontend's `dto.discount_amount` is intentionally
        // ignored — only the value returned by `CouponsService.validate`
        // (computed server-side) is persisted in `coupon_uses`, kept
        // separate from the promotional discount stored in `order_promotions`.
        //
        // CP-POS-CREAR-EDITAR-COBRAR-001 — B.2 coupon lifecycle: a DRAFT is a
        // saved business order, NOT a charged sale. We must NOT persist
        // `coupon_uses` and must NOT increment `coupons.current_uses` here; the
        // coupon validation/commit belongs to `flow/pay`. Otherwise an
        // abandoned draft would burn the coupon quota, and a successful draft →
        // pay → cancel loop would leave a phantom row in `coupon_uses`.
        if (
          !createPosPaymentDto.is_draft &&
          couponInfo.coupon_id &&
          couponInfo.discount_amount > 0
        ) {
          // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR F18.
          // Idempotency guard: a retry of the same payment attempt would
          // create a duplicate `coupon_uses` row and double-burn the
          // coupon quota. `coupon_uses` lacks a (order_id, coupon_id)
          // unique constraint, so we probe with `findFirst` and skip the
          // create when a row already exists.
          const existingUse = await tx.coupon_uses.findFirst({
            where: {
              order_id: order.id,
              coupon_id: couponInfo.coupon_id,
            },
            select: { id: true },
          });
          if (!existingUse) {
            await tx.coupon_uses.create({
              data: {
                coupon_id: couponInfo.coupon_id,
                order_id: order.id,
                customer_id: createPosPaymentDto.customer_id || null,
                discount_applied: couponInfo.discount_amount,
              },
            });
          }
          // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER F17
          // + MAJOR F22. Two fixes in one updateMany:
          //   F17: idempotent counter — use `updateMany` with the
          //   `state='active'` guard so a stale / inactive coupon
          //   doesn't increment blindly. count===0 throws
          //   `ORD_EDIT_COUPON_COMMIT_001`, the same way the editor
          //   surfaces this race.
          //   F22: pin the coupon to the current store via
          //   `stores: { some: { id: storeId } }` so a coupon from a
          //   DIFFERENT tenant can never sneak through the `id` match.
          // We omit the `max_uses > current_uses` clause from the WHERE
          // because Prisma's updateMany lacks row-self-referencing
          // operators; the editor handles that quota guard with a
          // pre-flight `validate()` call that we already trust above.
          const inc = await tx.coupons.updateMany({
            where: {
              id: couponInfo.coupon_id,
              stores: { some: { id: createPosPaymentDto.store_id } },
              state: 'active',
            },
            data: { current_uses: { increment: 1 } },
          });
          if (inc.count === 0) {
            throw new VendixHttpException(
              ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
              undefined,
              {
                stage: 'pos_increment',
                coupon_id: couponInfo.coupon_id,
                store_id: createPosPaymentDto.store_id,
              },
            );
          }
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
          // Restaurant Suite (Obj 4/6): the session closed by a POS table
          // close-out (null when a digital payment deferred the close). Used
          // AFTER commit to emit `session_closed` to staff + comensal streams.
          closed_session_id: orderCreation.closedSessionId ?? null,
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
        // Red de seguridad para la contención real de varias cajas cobrando a
        // la vez, NO el arreglo del P2028: ese vino de quitar las lecturas
        // redundantes de arriba. El default implícito de Prisma es 5000 ms y el
        // repo ya fija opciones donde la transacción es larga
        // (`order-flow.service.ts` usa 20 s). Si un cobro necesita más que
        // esto para pasar, el problema es la transacción — subir el número la
        // deja sosteniendo locks más tiempo y empeora la contención.
      }, { timeout: 20_000, maxWait: 5_000 });

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
              // QUI-651 — todos los tickets del envio, para que el SSE llegue a
              // cada estacion. Fallback al primario si el resultado viene de un
              // camino que todavia no los expone.
              ticketIds: result.kitchen_fire.kitchen_ticket_ids ?? [
                result.kitchen_fire.kitchen_ticket_id,
              ],
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

      // Restaurant Suite (Obj 4): if the POS payment closed out a table
      // session (cash/card/transfer — NOT a deferred digital payment), emit
      // `session_closed` AFTER the commit so the staff dashboard + the
      // comensal storefront learn of the close in real time. A rollback would
      // have thrown before reaching here, so no phantom event is possible.
      if (result.closed_session_id) {
        this.tableSessionsService.emitSessionClosed(
          ctxStoreId,
          result.closed_session_id,
        );
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
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · `order.draft_saved`.
        //
        // Emit AFTER the $transaction commits (we are outside it here) so an
        // audit row never claims a save that the DB rolled back. Correlate by
        // `request_id` so support can pivot from a frontend error / X-Request-Id
        // straight to the timeline row. Wrapped in try/catch: a missing audit
        // row is observability debt, never a blocker for an already-persisted
        // draft.
        const draftCtx = RequestContextService.getContext();
        try {
          await this.auditService.logCustom(
            user?.id,
            'order.draft_saved',
            AuditResource.ORDERS,
            {
              order_id: result.order.id,
              order_number: result.order.order_number,
              store_id: createPosPaymentDto.store_id,
              user_id: user?.id,
              request_id: draftCtx?.request_id,
              customer_id: createPosPaymentDto.customer_id ?? null,
              // Carry enough snapshot to reconstruct the save intent without
              // touching the order row again: no payment, no coupon use, no
              // accounting entries — that is exactly the point of a draft.
              has_customer: !!createPosPaymentDto.customer_id,
              requires_payment: false,
              grand_total: result.order.total_amount,
            },
            Number(result.order.id),
          );
        } catch (err) {
          this.logger.warn(
            `[POS] draft_saved audit failed for order #${result.order.id}: ${(err as Error).message}`,
          );
        }

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

        // ─────────────────────────────────────────────────────────────────
        // AQUÍ LA VENTA SE DESACOPLA DE LA TRANSMISIÓN A LA DIAN.
        //
        // Todo lo de arriba ya está confirmado en base de datos: el pedido, el
        // pago, el inventario y el movimiento de caja. `emit()` no espera al
        // oyente, así que a partir de esta línea la facturación electrónica
        // corre por su cuenta y NADA de lo que le pase puede volver acá: ni un
        // timeout de la DIAN, ni un certificado vencido, ni una caída de red
        // pueden dejar al cajero sin poder cobrar al siguiente cliente.
        //
        // Va DESPUÉS del commit y no junto a los otros `emit` de la
        // transacción (paso 4) porque un oyente que lea el pedido antes del
        // COMMIT correría contra él, y sobre todo porque un rollback posterior
        // dejaría un documento fiscal emitido de una venta que nunca existió —
        // y eso la DIAN no lo deshace.
        //
        // El estado resultante se consulta aparte:
        // `GET /store/invoicing/pos/orders/:orderId/fiscal-status`.
        if (result.order?.id) {
          this.eventEmitter.emit(POS_SALE_COMPLETED_EVENT, {
            organization_id: Number(context?.organization_id),
            store_id: ctxStoreId,
            user_id: user?.id,
            order_id: Number(result.order.id),
            order_number: result.order.order_number,
            // La tienda decide si el documento sale solo. Ausente ≡ sí: una
            // tienda habilitada ante la DIAN debe soportar cada venta con un
            // documento, y esperar a que alguien se acuerde de pedirlo a mano
            // es como se acumulan ventas sin soporte.
            auto_emit:
              (settings as any)?.invoicing?.pos?.auto_emit ??
              DEFAULT_POS_AUTO_EMIT,
          } as PosSaleCompletedEvent);
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
          applied_price_tier_id: item.applied_price_tier_id ?? null,
          stock_units_consumed: item.stock_units_consumed ?? null,
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
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR M6.
        // Pin `store_id` so the coupon validation knows WHICH tenant's
        // coupon pool to look in. The DTO's `validate` shape doesn't
        // declare this field yet, hence the `as any` carry-over from
        // the previous line; the service-side method reads from the
        // object directly and ignores unknown keys via `forbidNonWhitelisted`
        // being off in the inner ValidationPipe-less call path.
        store_id: dto.store_id,
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
        // `cost_price` viaja con el producto que esta función ya carga: pedirlo
        // aquí evita el round-trip extra que hacía `resolveCostPrice` dentro de
        // la transacción del cobro (causa del P2028).
        cost_price: true,
        // QUI-648 — a cuántas unidades de stock corresponde `base_price`. Sale
        // de la misma lectura que ya valida que el producto es de esta tienda:
        // la escala NO puede venir del cliente, es del catálogo.
        price_unit_quantity: true,
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
            // Idem: el costo de la variante sale de la misma lectura que ya
            // valida su pertenencia al producto.
            cost_price: true,
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
                // `id` es lo que permite al resolver elegir la fila de override
                // de ESTA variante en vez de caer a la del producto.
                id: variant.id,
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
    // `client: tx` explícito: sin él esta consulta saldría por otra conexión del
    // pool mientras la transacción del cobro sostiene locks, y con suficientes
    // cajas cobrando a la vez el pool se agota y nadie avanza.
    // `store_id` explícito: el `tx` viene del `baseClient` (ver
    // `base-prisma.service.ts:43`), o sea SIN el scoping de la extensión, así que
    // el filtro de tenant que `product_tax_assignments` traía automáticamente hay
    // que escribirlo a mano.
    const catalogTaxInfo = await this.taxes_service.calculateProductTaxes(
      product.id,
      catalogUnitPrice,
      { client: tx, store_id: dtoStoreId },
    );
    const catalogFinalPrice = this.roundMoney(
      catalogUnitPrice + catalogTaxInfo.total_tax_amount,
    );

    /**
     * QUI-648 — precio por N unidades de stock en el cobro POS.
     *
     * `catalogUnitPrice` es el precio publicado (`base_price`), y ese precio
     * cubre `price_unit_quantity` unidades de stock: un cable a "$5.000 el
     * metro" guarda 5.000 con escala 1.000 y la línea llega en milímetros. El
     * multiplicador monetario de la línea NO es la cantidad, es la cantidad
     * dividida por la escala — 3.000 mm son 3 unidades de precio.
     *
     * Sin esto el cobro POS multiplicaba precio × milímetros y cobraba mil
     * veces de más, y ninguna validación lo frenaba: este camino NO usa el
     * total del DTO, lo reconstruye acá, así que el error nacía en el servidor
     * y no había nada que "verificar" contra el cliente.
     *
     * Dos exclusiones, espejo exacto de `resolveLineUnits` en el frontend:
     *  - Línea de PESO legado: el peso capturado ya ES el multiplicador.
     *  - Línea con PRESENTACIÓN aplicada (`packSize > 1`): `unit_price` es el
     *    precio del paquete y `quantity` cuenta paquetes; dividir cobraría de
     *    menos. Las unidades de stock que consume viajan aparte en
     *    `stock_units_consumed`.
     *
     * La exclusión es la PRESENTACIÓN, no "la línea trae tarifa". Una tarifa de
     * cliente (Mayorista) cambia el precio y lo sigue expresando por unidad de
     * PRECIO, así que la escala aplica igual. Excluyéndola, `priceUnits` quedaba
     * en milímetros, `resolveRequestedFinalUnitPrice` derivaba $4,50 contra un
     * catálogo de $4.500 y el guard de override **rechazaba el cobro**: el POS
     * no podía vender con tarifa de cliente ningún producto con escala.
     *
     * Con la escala por defecto (1) `priceUnits === lineUnits` y no cambia un
     * solo número de todo el catálogo existente.
     */
    const esPresentacion =
      resolvePackSize(
        tierSnap?.units_per_package,
        tierSnap?.override_units_per_package,
      ) > 1;
    const priceUnitQuantity =
      esPresentacion || Number(item.weight || 0) > 0
        ? 1
        : resolvePriceUnitScale(product.price_unit_quantity);
    const priceUnits = resolvePriceUnits(lineUnits, priceUnitQuantity);

    const finalUnitPrice = this.resolveRequestedFinalUnitPrice(
      item,
      priceUnits,
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
    // Misma tasa, otra base gravable: se reescala en memoria en vez de volver a
    // consultar el mismo `product_id` (ver `rescaleTaxInfo`).
    const taxInfo = this.rescaleTaxInfo(catalogTaxInfo, unitBasePrice);
    // Snapshot de costo de venta. La prioridad variante > producto > null vive en
    // `pickCostPrice` (único dueño de la regla); aquí se aplica sobre las filas
    // que esta función ya cargó, así que no cuesta ninguna consulta.
    const costPrice = pickCostPrice(variant?.cost_price, product.cost_price);

    return this.buildOrderItemSnapshot({
      item,
      productName: item.product_name || product.name,
      sku: item.product_sku || variant?.sku || product.sku,
      description: item.description || item.notes,
      itemType: product.product_type === 'service' ? 'service' : 'physical',
      quantity: item.quantity,
      lineUnits: priceUnits,
      priceUnitQuantity,
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

  /**
   * Reescala un desglose de impuestos ya resuelto sobre otra base gravable.
   *
   * `TaxesService.calculateProductTaxes` lee la tasa de la DB (un `findMany`
   * con `include` anidado de dos niveles sobre `product_tax_assignments` →
   * `tax_categories` → `tax_rates`) y después solo multiplica: `total_rate` no
   * depende del `basePrice`, y cada `amount` es `basePrice * rate`. Pedir el
   * mismo `product_id` otra vez para una base distinta era, por eso, una
   * consulta redundante — y una que sale por `this.prisma` (otra conexión del
   * pool) mientras la transacción del cobro sostiene locks. Dos de esas por
   * ítem fue una de las causas medidas del P2028.
   *
   * El tipo se deriva del propio servicio: si su contrato cambia, esto falla en
   * compilación en vez de divergir en silencio.
   */
  private rescaleTaxInfo(
    source: Awaited<ReturnType<TaxesService['calculateProductTaxes']>>,
    basePrice: number,
  ): Awaited<ReturnType<TaxesService['calculateProductTaxes']>> {
    return {
      total_rate: source.total_rate,
      total_tax_amount: basePrice * source.total_rate,
      taxes: source.taxes.map((tax) => ({
        ...tax,
        amount: basePrice * tax.rate,
      })),
    };
  }

  private buildOrderItemSnapshot(params: {
    item: any;
    productName: string;
    sku?: string | null;
    description?: string;
    itemType: string;
    quantity: number;
    /**
     * Multiplicador monetario YA convertido a unidades de precio (ver
     * `buildPosOrderItem`). Con escala 1 es la cantidad de siempre.
     */
    lineUnits: number;
    /**
     * QUI-648 — `products.price_unit_quantity` vigente al vender. Se
     * snapshotea porque sin él el total deja de ser reproducible en cuanto el
     * comerciante cambie el producto de "por metro" a "por rollo". `1` (o
     * ausente) significa escala histórica y se persiste como `null`.
     */
    priceUnitQuantity?: number;
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
      notes: params.item.notes || undefined,
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
      // QUI-648 — escala del precio al momento de vender. Solo se guarda
      // cuando realmente hay escala: `null` es "una unidad de stock = una
      // unidad de precio", que es todo el catálogo histórico.
      price_unit_quantity:
        params.priceUnitQuantity != null && params.priceUnitQuantity > 1
          ? params.priceUnitQuantity
          : null,
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
   * True when a POS payment must be DEFERRED past the payment transaction
   * commit: the method requires a real charge (`requires_payment`) AND is a
   * digital gateway (`wompi` | `wallet`) that only settles asynchronously via
   * webhook. Cash / card / bank_transfer settle in-band and return `false`.
   *
   * Single source of truth (mirror of the historical inline `isDigitalPayment`
   * check in `processPosPayment`). Also gates the table-session close in
   * `applyPosPaymentToTableSession`: a deferred digital payment must NOT close
   * the table until its webhook confirms the charge (otherwise the mesa would
   * flip to `cleaning` while the diner could still abandon the Wompi widget).
   */
  private async isDeferredDigitalMethod(
    tx: any,
    dto: CreatePosPaymentDto,
  ): Promise<boolean> {
    if (!dto.requires_payment) return false;
    const method = await tx.store_payment_methods.findUnique({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });
    const type = method?.system_payment_method?.type || '';
    return ['wompi', 'wallet'].includes(type);
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
    // Restaurant Suite (edge Wompi): the session id that was CLOSED in this
    // transaction, or null when the close was deferred (digital payment
    // awaiting webhook) or nothing was closed. The caller emits `session_closed`
    // post-commit only when this is non-null.
    closedSessionId: number | null;
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

    // QUI-704 — second-charge guard. Now that the session is no
    // longer auto-closed on payment, a second applyPosPaymentToTableSession
    // call (e.g., operator double-clicks "Cobrar" or the POS retries
    // after a network blip) would re-merge items into a fresh order
    // total and double-bill the customer. Block the second attempt
    // by checking for a previously-succeeded payment on the same
    // order — the canonical close path stays the canonical close
    // path; the only thing that changed is that this branch no
    // longer closes the session, so we must guard against re-entry
    // here.
    const existingPaid = await tx.payments.findFirst({
      where: {
        order_id: session.order_id,
        state: 'succeeded',
      },
      select: { id: true, transaction_id: true, amount: true },
    });
    if (existingPaid) {
      throw new VendixHttpException(
        ErrorCodes.POS_TABLE_SESSION_ALREADY_CHARGED,
        `La sesión de mesa ya fue cobrada (payment #${existingPaid.id} / ${existingPaid.transaction_id} por ${existingPaid.amount})`,
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
        ? await resolveTierSnapshotsForItems(tx, dto.items, context)
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
        // Idem `createOrUpdateOrderFromPos`: `tax_amount_item` es por unidad
        // de PRECIO, no por unidad de stock (QUI-648).
        const multiplier =
          Number((item as any).weight || 0) > 0
            ? 1
            : resolvePriceUnits(
                Number(item.quantity || 1),
                (item as any).price_unit_quantity,
              );
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

    // Table lifecycle on POS sale confirmation:
    //
    // The table STAYS `occupied` and the session STAYS OPEN after a POS
    // sale. The order is persisted (with its order_items, totals, payments
    // row, inventory, journal) and the table remains on the "occupied" list
    // for staff. The session is only closed (and the table transitions to
    // `cleaning`) when the operator explicitly closes the account via the
    // canonical `TableSessionsService.closeSession` endpoint — never at
    // sale time. This matches the user's expected flow:
    //   1. POS sale confirmed → table `occupied`, session OPEN
    //   2. Staff closes account via tables module → `closeSession` →
    //      session closed, table → `cleaning`
    //   3. Staff marks table ready → `cleaning` → `available`
    //
    // Deferred payments (Wompi / wallet pending) ALREADY keep the session
    // open and the table `occupied` (the canonical closeSession path closes
    // it later when the gateway webhook confirms payment). For non-deferred
    // payments, we used to close the session here AND set the table to
    // `cleaning` — that was the bug: the table vanished from the
    // "occupied" list and the operator lost track of the active session
    // until they explicitly re-opened it. The fix removes both side effects
    // so both flows behave the same: session open, table `occupied` until
    // someone calls the canonical closeSession.
    //
    // POS sale confirmation must never auto-close the table session or flip
    // `tables.status`. The canonical `TableSessionsService.closeSession`
    // endpoint owns that transition, called explicitly by staff when the
    // account is closed out. Deferred digital payments (Wompi/wallet) close
    // through the gateway webhook, never here. `closedSessionId` is kept
    // in the return shape so the post-commit `session_closed` SSE emission,
    // gated on `result.closed_session_id`, never fires from POS.
    //
    // `isDeferredDigitalMethod` was historically queried in this branch; it
    // is no longer needed because both deferred and non-deferred flows now
    // share the same lifecycle. Re-introduce it here only if a downstream
    // consumer (operator hint, async messaging) needs to branch on it.
    const closedSessionId: number | null = null;

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
      closedSessionId,
    };
  }

  /**
   * QUI-535 — resolve the `table_sessions.id` a POS payment must be
   * applied to, given only the `tables.id` the cashier picked.
   *
   * Runs INSIDE the payment transaction and is the seam that moves the
   * "abrir mesa" write from the checkout wizard (where a back-navigation,
   * a switch to takeaway or a closed tab left the mesa `occupied` with a
   * $0 draft order forever) to the charge itself.
   *
   * Behavior:
   *  1. The table must exist and belong to the request store — checked
   *     BEFORE any write, mirroring `applyPosPaymentToTableSession`.
   *  2. If the mesa already has an open check (opened from the tables
   *     module or by a diner scanning the QR), that session is REUSED.
   *     Idempotent on purpose — same contract as
   *     `TableSessionsService.openTableSessionPublic`; it must never fail
   *     with `TABLE_SESSION_ALREADY_OPEN`, and it must never create a
   *     second check for one mesa.
   *  3. Otherwise the mesa is opened via
   *     `TableSessionsService.createOpenSessionInTx` on THIS transaction,
   *     so the draft order + session + `tables.status='occupied'` commit
   *     (or roll back) together with the payment.
   *
   * Why the lookup uses `tx` instead of `TablesService.getActiveSession`:
   * the read must see this transaction's own snapshot (the caller may
   * retry, and the very next statements write the session we are about to
   * create), and `TablesService` queries the non-transactional client, so
   * it cannot honor read-your-writes here. `PaymentsService` also does not
   * depend on `TablesService`, and wiring it in would mean touching
   * `payments.module.ts`, outside this change. The `store_id` filter is
   * therefore written explicitly — the scope-safe `findFirst` shape from
   * `vendix-prisma-scopes`, never `findUnique`.
   *
   * NOTE: `session_opened` is deliberately NOT emitted for a mesa opened
   * here. In the normal POS flow (cash/card/transfer) the session is
   * opened and closed in this same transaction, and the post-commit
   * `session_closed` emission already carries the observable transition.
   */
  private async resolvePosTableSessionId(
    tx: any,
    tableId: number,
    dtoStoreId: number,
    dto: CreatePosPaymentDto,
    user: any,
  ): Promise<number> {
    const table = await tx.tables.findFirst({ where: { id: tableId } });
    if (!table) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_NOT_FOUND,
        'Mesa no encontrada',
      );
    }
    if (table.store_id !== dtoStoreId) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'La mesa pertenece a otra tienda',
      );
    }

    const activeSession = await tx.table_sessions.findFirst({
      where: {
        table_id: tableId,
        store_id: dtoStoreId,
        closed_at: null,
      },
      orderBy: { opened_at: 'desc' },
      select: { id: true },
    });
    if (activeSession) {
      return activeSession.id;
    }

    const opened = await this.tableSessionsService.createOpenSessionInTx(tx, {
      tableId,
      storeId: dtoStoreId,
      openedBy: user?.id ?? null,
      customerId: dto.customer_id ?? null,
      channel: 'pos',
      deliveryType: 'direct_delivery',
      // The POS charge does not capture the party size; the mesa can be
      // annotated later via `setGuestCount` exactly like a QR open.
      guestCount: null,
      internalNotes: 'Mesa abierta al cobrar desde POS',
      // Already resolved by `processPosPayment` before opening the
      // transaction — passing it avoids a settings read while the tx is
      // held open.
      currency: dto.currency,
    });

    return opened.id;
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

    // QUI-535: the restaurant POS now sends `table_id` instead of a
    // session id — picking a mesa in the checkout wizard is a pure
    // selection that writes nothing. The mesa is materialized HERE, in
    // the payment transaction: an existing open check is reused, a new
    // one is opened atomically, and either way we fall through to the
    // SAME close-out path the tables module and the QR flow already use
    // (totals, KDS fire, session close, `tables.status='cleaning'`,
    // journal entries). A mesa therefore can never be `occupied` without
    // a charged sale behind it.
    //
    // `table_session_id` takes precedence when both arrive (it is the
    // more specific reference), which is why this branch is guarded on
    // its absence and sits after it.
    if (dto.table_id != null) {
      const resolvedSessionId = await this.resolvePosTableSessionId(
        tx,
        dto.table_id,
        dtoStoreId,
        dto,
        user,
      );
      // Shallow clone instead of mutating the caller's DTO: the rest of
      // `processPosPayment` must keep seeing the request exactly as it
      // arrived, while the close-out helper reads a resolved session id.
      return await this.applyPosPaymentToTableSession(
        tx,
        { ...dto, table_session_id: resolvedSessionId },
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
    const tierSnapshots = await resolveTierSnapshotsForItems(
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

            // `tax_amount_item` es el impuesto de UNA unidad de precio, así
            // que el multiplicador tiene que ser el mismo que usó el total de
            // la línea: la cantidad convertida por la escala (QUI-648). Con
            // escala 1 —o `null`— vuelve a ser la cantidad de siempre.
            const multiplier =
              Number(item.weight || 0) > 0
                ? 1
                : resolvePriceUnits(
                    Number(item.quantity || 1),
                    item.price_unit_quantity,
                  );
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
          // Fresh sales never close a table session — only the table close-out
          // branch (`applyPosPaymentToTableSession`) can. Keep the shape aligned.
          closedSessionId: null as number | null,
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

  // --------------------------------------------------------------------
  // C3 — staff-confirmed payment helper
  // --------------------------------------------------------------------
  /**
   * Confirm a previously-pending payment by transitioning it to `succeeded`
   * and emitting the canonical `payment.received` event so the auto-entry
   * listener (`AccountingEventsListener`) and the notification listener
   * both fire with the SAME shape as the POS fresh-sale path.
   *
   * Designed for flows where the payment row was created in `state='pending'`
   * by an upstream actor (e.g. comensal requesting the bill via QR) and is
   * later confirmed by staff (manual methods: cash / bank_transfer) — NOT
   * Wompi/webhooks, which are already final at creation.
   *
   * CAS semantics: if the payment is no longer `pending` (already `succeeded`
   * by a webhook, another staff, or a duplicate call), this method is a
   * no-op and returns `false`. Otherwise it updates the row in the caller's
   * transaction (`tx`) and emits the event AFTER the state write succeeds
   * (event emissions are not transactional — the listener will simply see
   * a duplicate event if the outer `$transaction` aborts, which is harmless
   * because the accounting listener is idempotent on `payment_id`).
   *
   * This helper does NOT:
   *   - close the order (the order lifecycle is owned by callers).
   *   - close the table session (the session lifecycle is owned by callers).
   *   - write to `cash_register_movements` (run AFTER commit by the caller
   *     using `recordCashRegisterMovement`, mirroring the POS fresh-sale flow).
   *
   * It is intentionally `public` so future cross-module consumers (e.g.
   * `TableSessionsService.confirmPayment`) can call it without re-implementing
   * the CAS + emit logic. Not currently injected (would require a module
   * wiring change) — callers duplicate the logic for now.
   */
  async applyConfirmedPaymentToOrder(args: {
    paymentId: number;
    staffUser: { id: number; store_id: number };
    tx: Prisma.TransactionClient;
  }): Promise<boolean> {
    const { paymentId, staffUser, tx } = args;

    // CAS load — only proceed if the payment is still pending.
    const payment = await tx.payments.findUnique({
      where: { id: paymentId },
      include: {
        store_payment_method: {
          include: { system_payment_method: true },
        },
        orders: {
          select: {
            id: true,
            order_number: true,
            subtotal_amount: true,
            tax_amount: true,
            discount_amount: true,
            tip_amount: true,
            customer_id: true,
            stores: { select: { organization_id: true } },
          },
        },
      },
    });
    if (!payment) {
      throw new VendixHttpException(
        ErrorCodes.PAY_FIND_001,
        `Pago #${paymentId} no encontrado`,
      );
    }
    if (payment.state !== 'pending') {
      // Already final — idempotent short-circuit.
      this.logger.debug(
        `[applyConfirmedPaymentToOrder] payment ${paymentId} state=${payment.state}; skipping (already final).`,
      );
      return false;
    }

    // 1. Transition the payment row to `succeeded`.
    await tx.payments.update({
      where: { id: paymentId },
      data: {
        state: 'succeeded',
        paid_at: new Date(),
        updated_at: new Date(),
      },
    });

    // 2. Update `orders.total_paid` / `remaining_balance` so the order
    //    reflects the new paid amount. Mirrors the GAP-2 helper used by
    //    `processPosPaymentTransaction`.
    await this.applyOrderBalanceOnPayment(
      tx,
      payment.order_id,
      Number(payment.amount),
    );

    // 3. Emit `payment.received` with the SAME shape as the POS fresh-sale
    //    path (payments.service.ts L1179) so the auto-entry listener maps
    //    the cash/bank/tip lines identically. Tax breakdown is intentionally
    //    omitted here (table-session checks are typically dine-in with no
    //    withholding applied at the payment step — the order's persisted
    //    tax_breakdown is on `order_item_taxes`, but at this layer we only
    //    need the totals for the accounting listener).
    this.eventEmitter.emit('payment.received', {
      payment_id: payment.id,
      store_id: staffUser.store_id,
      organization_id: payment.orders?.stores?.organization_id,
      order_id: payment.order_id,
      order_number: payment.orders?.order_number,
      amount: Number(payment.amount),
      subtotal_amount: Number(payment.orders?.subtotal_amount || 0),
      tax_amount: Number(payment.orders?.tax_amount || 0),
      tax_breakdown: [],
      withholding_breakdown: [],
      discount_amount: Number(payment.orders?.discount_amount || 0),
      tip_amount: Number(payment.orders?.tip_amount || 0),
      currency: payment.currency || 'COP',
      payment_method:
        payment.store_payment_method?.system_payment_method?.display_name ||
        payment.store_payment_method?.display_name ||
        'Unknown',
      user_id: staffUser.id,
      customer: payment.orders?.customer_id
        ? { id: Number(payment.orders.customer_id) }
        : undefined,
    });

    this.logger.log(
      `[applyConfirmedPaymentToOrder] payment ${paymentId} → succeeded by staff ${staffUser.id} (order ${payment.order_id})`,
    );

    return true;
  }
}
