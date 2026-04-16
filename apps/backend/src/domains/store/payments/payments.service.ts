import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { PaymentGatewayService } from './services/payment-gateway.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { TaxesService } from '../taxes/taxes.service';
import { LocationsService } from '../inventory/locations/locations.service';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
  CreatePosPaymentDto,
  PosPaymentResponseDto,
  UpdateOrderWithPaymentDto,
} from './dto';
import { PaymentError, PaymentErrorCodes, LEGACY_TO_NEW } from './utils';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { resolveCostPrice } from '../orders/utils/resolve-cost-price';
import { calculateSchedule } from '../orders/utils/installment-schedule-calculator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { PaymentEncryptionService } from './services/payment-encryption.service';
import { InvoiceDataRequestsService } from '../invoicing/invoice-data-requests/invoice-data-requests.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: StorePrismaService,
    private paymentGateway: PaymentGatewayService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly taxes_service: TaxesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    private readonly paymentEncryption: PaymentEncryptionService,
    private readonly invoiceDataRequestsService: InvoiceDataRequestsService,
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
    try {
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
        // 1. Create or update order
        const order = await this.createOrUpdateOrderFromPos(
          tx,
          createPosPaymentDto,
          user,
        );

        // 1.5. Reserve stock for each item with track_inventory
        // Resolve default location inside tx to avoid scoping mismatch with getDefaultLocationForProduct()
        const defaultLocation = await tx.inventory_locations.findFirst({
          where: { store_id: order.store_id, is_active: true },
          orderBy: { id: 'asc' },
          select: { id: true },
        });

        for (const item of order.order_items) {
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

            // Use stock_level with highest available for this product, falling back to store default location
            const stockLevel = await tx.stock_levels.findFirst({
              where: {
                product_id: item.product_id,
                product_variant_id: item.product_variant_id || null,
                quantity_available: { gt: 0 },
              },
              orderBy: { quantity_available: 'desc' },
              select: { location_id: true },
            });
            const location_id = stockLevel?.location_id || defaultLocation?.id;

            if (!location_id) {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stock_reserve_sp');
              this.logger.warn(`No location found for stock reservation of product ${item.product_id} in order #${order.id}`);
              continue;
            }

            await this.stockLevelManager.reserveStock(
              item.product_id,
              item.product_variant_id || undefined,
              location_id,
              item.quantity,
              'order',
              order.id,
              user?.id,
              false, // POS: don't validate availability (non-restrictive UX)
              tx,
            );

            await tx.$executeRawUnsafe('RELEASE SAVEPOINT stock_reserve_sp');
          } catch (error) {
            // Rollback to savepoint to recover the transaction from PostgreSQL's aborted state
            try { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT stock_reserve_sp'); } catch {}
            this.logger.warn(`Stock reservation failed for product ${item.product_id} in order #${order.id}: ${error.message}`);
          }
        }

        // 1.6. Apply promotions if provided
        if (createPosPaymentDto.promotion_ids?.length) {
          for (const promoId of createPosPaymentDto.promotion_ids) {
            try {
              const { discount } =
                await this.promotionEngine.validatePromotion(
                  promoId,
                  createPosPaymentDto.items.map((i) => ({
                    product_id: i.product_id,
                    unit_price: i.unit_price,
                    quantity: i.quantity,
                  })),
                  createPosPaymentDto.customer_id,
                );
              await this.promotionEngine.applyPromotion(
                order.id,
                promoId,
                discount,
                createPosPaymentDto.customer_id ?? null,
                tx,
              );
            } catch (e) {
              // Silent: promotion validation failed, continue without it
            }
          }
        }

        // 2. Process payment if required
        let payment: any = null;
        const isDigitalPayment = createPosPaymentDto.requires_payment &&
          ['wompi', 'wallet'].includes(
            (await tx.store_payment_methods.findUnique({
              where: { id: createPosPaymentDto.store_payment_method_id },
              include: { system_payment_method: true },
            }))?.system_payment_method?.type || '',
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
            order.delivery_type,
          );
        } else if (isDigitalPayment) {
          // Digital methods (Wompi, wallet) — mark as pending, process AFTER commit
          await this.updateOrderPaymentStatus(
            tx,
            order.id,
            'pending_payment',
            order.delivery_type,
          );
        } else {
          // Credit sale - update order status
          await this.updateOrderPaymentStatus(
            tx,
            order.id,
            'pending_payment',
            order.delivery_type,
          );
        }

        // 3. Update inventory only when product is physically delivered
        // Direct delivery with payment = finished = product left our hands
        // Any other flow (home_delivery, credit sale) = keep reservation until delivery/cancellation
        const isDirectDeliveryFinished =
          createPosPaymentDto.requires_payment &&
          order.delivery_type !== 'home_delivery';

        if (createPosPaymentDto.update_inventory && isDirectDeliveryFinished) {
          await this.updateInventoryFromOrder(tx, order);
        }

        // 4. Emit order.created event
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
            discount_amount: Number(order.discount_amount || 0),
            currency: payment.currency || createPosPaymentDto.currency,
            payment_method:
              payment.store_payment_method?.system_payment_method
                ?.display_name || 'Unknown',
            user_id: user.id,
          });

          // 5b. Emit order.completed for COGS on direct POS sales
          if (order.delivery_type === 'direct_delivery') {
            const total_cost = order.order_items.reduce(
              (sum: number, item: any) => sum + Number(item.cost_price || 0) * item.quantity,
              0,
            );
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
            discount_amount: Number(order.discount_amount || 0),
            total_amount: Number(order.grand_total || 0),
            user_id: user.id,
          });
        }

        // 5d. Register coupon use if applicable
        if (createPosPaymentDto.coupon_id && (createPosPaymentDto.discount_amount ?? 0) > 0) {
          await tx.coupon_uses.create({
            data: {
              coupon_id: createPosPaymentDto.coupon_id,
              order_id: order.id,
              customer_id: createPosPaymentDto.customer_id || null,
              discount_applied: createPosPaymentDto.discount_amount,
            },
          });
          await tx.coupons.update({
            where: { id: createPosPaymentDto.coupon_id },
            data: { current_uses: { increment: 1 } },
          });
        }

        // 6. Send confirmation if required
        if (createPosPaymentDto.send_email_confirmation) {
          // TODO: Implement email confirmation
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
            payment_status: payment ? payment.state : (isDigitalPayment ? 'pending' : 'pending'),
            total_amount: order.grand_total,
          },
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
                nextAction: (payment as any)?.nextAction,
              }
            : undefined,
          nextAction: (payment as any)?.nextAction,
          _digitalPaymentPending: isDigitalPayment || false,
        };
      });

      // Process digital payments AFTER transaction commit (order is now visible)
      if (result.success && result._digitalPaymentPending) {
        try {
          const payment = await this.processPosPaymentTransaction(
            this.prisma as any,
            { id: result.order.id, store_id: createPosPaymentDto.store_id } as any,
            createPosPaymentDto,
          );
          if (payment) {
            result.payment = {
              id: payment.id,
              amount: payment.amount,
              payment_method:
                payment.store_payment_method?.display_name ||
                payment.store_payment_method?.system_payment_method?.display_name ||
                'Wompi',
              status: payment.state,
              transaction_id: payment.transaction_id,
              change: 0,
              nextAction: (payment as any)?.nextAction,
            };
            result.nextAction = (payment as any)?.nextAction;
            result.message = 'Payment initiated successfully';
          }
        } catch (err) {
          this.logger.error(`Digital payment processing failed: ${err.message}`, err.stack);
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
            this.logger.error(`Failed to revert order/stock: ${revertErr.message}`);
          }
        }
        delete result._digitalPaymentPending;
      }

      // Record cash register movement AFTER transaction commit (non-critical)
      if (result.success) {
        this.recordCashRegisterMovement(
          createPosPaymentDto,
          result.order,
          result.payment,
          user,
        ).catch((err) => {
          this.logger.error(`Failed to record cash register movement: ${err.message}`, err.stack);
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
            const invoiceDataRequest = await this.invoiceDataRequestsService.createRequest(
              createPosPaymentDto.store_id,
              Number(result.order.id),
            );
            result.order.invoice_data_token = invoiceDataRequest.token;
          } catch (err) {
            this.logger.error(`Failed to create invoice data request: ${err.message}`, err.stack);
          }
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error processing payment',
        errors: [error.message],
      };
    }
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
        const amountToFinance = Math.round((Number(order.total_amount) - initialPayment) * 100) / 100;

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
        updateData.remaining_balance = Math.round(totalInstallments * 100) / 100;

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
              store_payment_method_id:
                terms.initial_payment_method_id || null,
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
          const totalInterest =
            Number(order.total_amount) * interestRate;
          updateData.total_with_interest =
            Math.round(
              (Number(order.total_amount) + totalInterest) * 100,
            ) / 100;
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

  /**
   * Create or update order from POS data
   */
  private async createOrUpdateOrderFromPos(
    tx: any,
    dto: CreatePosPaymentDto,
    user: any,
  ) {
    let retries = 3;
    let orderNumber: string;

    while (retries > 0) {
      try {
        // Generate order number for this store
        orderNumber = await this.generateOrderNumber(tx, dto.store_id);

        // Create order items
        const orderItems = await Promise.all(
          dto.items.map(async (item) => {
            let item_tax_rate = item.tax_rate;
            let item_tax_amount = item.tax_amount_item;

            // If taxes are missing or 0, calculate them
            if (!item_tax_rate || item_tax_rate === 0) {
              const taxInfo = await this.taxes_service.calculateProductTaxes(
                item.product_id,
                item.unit_price,
              );
              item_tax_rate = taxInfo.total_rate;
              item_tax_amount = taxInfo.total_tax_amount;
            }

            const cost_price = await resolveCostPrice(
              tx,
              item.product_id,
              item.product_variant_id,
            );

            const orderItem: any = {
              product_name: item.product_name,
              variant_sku: item.product_sku,
              variant_attributes: item.variant_attributes
                ? JSON.stringify(item.variant_attributes)
                : undefined,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total_price: item.total_price,
              tax_rate: item_tax_rate,
              tax_amount_item: item_tax_amount,
              cost_price,
              weight: item.weight || undefined,
              weight_unit: item.weight_unit || undefined,
            };

            if (item.product_id) {
              orderItem.products = { connect: { id: item.product_id } };
            }

            if (item.product_variant_id) {
              orderItem.product_variants = {
                connect: { id: item.product_variant_id },
              };
            }

            return orderItem;
          }),
        );

        // Build order data - only include customer_id if provided (for anonymous sales)
        // Initial state is 'created' - state transitions handled by OrderFlowService
        const orderData: any = {
          store_id: dto.store_id,
          order_number: orderNumber,
          state: 'created', // Orders start in 'created' state, flow service handles transitions
          channel: 'pos', // POS orders are assigned 'pos' channel
          subtotal_amount: dto.subtotal,
          tax_amount: dto.tax_amount || 0,
          discount_amount: dto.discount_amount || 0,
          grand_total: dto.total_amount,
          currency: dto.currency,
          coupon_id: dto.coupon_id || undefined,
          coupon_code: dto.coupon_code || undefined,
          billing_address_id: dto.billing_address_id,
          shipping_address_id: dto.shipping_address_id,
          internal_notes: dto.internal_notes,
          // Shipping fields (for delivery orders)
          delivery_type: dto.delivery_type || 'direct_delivery',
          payment_form: dto.payment_form || (dto.requires_payment ? '1' : '2'),
          shipping_cost: dto.shipping_cost || 0,
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

        return order;
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
        amount: dto.total_amount,
        currency: dto.currency || 'COP',
        storePaymentMethodId: dto.store_payment_method_id,
        storeId: dto.store_id,
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
        (payment as any).nextAction = gatewayResult.nextAction;
        (payment as any).change = 0;
      }

      return payment;
    }

    // Direct methods (cash, card, bank_transfer) - existing flow continues below
    // Calculate change for cash payments
    let change = 0;
    if (
      paymentMethod.system_payment_method.type === 'cash' &&
      dto.amount_received
    ) {
      change = dto.amount_received - dto.total_amount;
    }

    // Create payment record
    const payment = await tx.payments.create({
      data: {
        order_id: order.id,
        store_payment_method_id: dto.store_payment_method_id,
        amount: dto.total_amount,
        currency: dto.currency,
        state: 'succeeded',
        transaction_id: await this.generateTransactionId(),
        gateway_response: {
          reference: dto.payment_reference,
          change: change,
          metadata: {
            register_id: dto.register_id,
            seller_user_id: dto.seller_user_id,
            amount_received: dto.amount_received,
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

    return payment;
  }

  /**
   * Update order payment status for POS transactions
   * For POS direct delivery with payment: created -> finished (immediate sale)
   * For POS home delivery with payment: created -> processing (needs shipping)
   * For POS without payment (credit sale): stays in 'created'
   */
  private async updateOrderPaymentStatus(
    tx: any,
    orderId: number,
    paymentState: string,
    deliveryType?: string,
  ) {
    let orderState: string;
    let additionalData: any = { updated_at: new Date() };

    switch (paymentState) {
      case 'succeeded':
        if (deliveryType === 'home_delivery') {
          // Shipping order — needs to be prepared and dispatched
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
   * Update inventory from order
   */
  private async updateInventoryFromOrder(tx: any, order: any) {
    for (const item of order.order_items) {
      const product = await tx.products.findUnique({
        where: { id: item.product_id },
        select: { track_inventory: true, product_type: true },
      });
      if (!product?.track_inventory || product.product_type === 'service') continue;

      // Find active reservation to get the correct location_id (matches Phase 1 reservation)
      const reservation = await tx.stock_reservations.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          reserved_for_type: 'order',
          reserved_for_id: order.id,
          status: 'active',
        },
      });

      if (reservation) {
        // Release reservation FIRST so quantity_available is restored before validation
        await this.stockLevelManager.releaseReservation(
          item.product_id,
          item.product_variant_id,
          reservation.location_id,
          'order',
          order.id,
          tx,
        );

        // Now deduct stock — available was restored, so validation passes
        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id,
            location_id: reservation.location_id,
            quantity_change: -item.quantity,
            movement_type: 'sale',
            reason: `POS Sale - Order ${order.order_number}`,
            user_id: order.created_by,
            order_item_id: item.id,
            create_movement: true,
            validate_availability: true,
          },
          tx,
        );
      } else {
        // Fallback: reservation failed silently in Phase 1, use default location
        const defaultLocation = await tx.inventory_locations.findFirst({
          where: { store_id: order.store_id, is_active: true },
          orderBy: { id: 'asc' },
        });

        if (!defaultLocation) continue;

        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id,
            location_id: defaultLocation.id,
            quantity_change: -item.quantity,
            movement_type: 'sale',
            reason: `POS Sale - Order ${order.order_number}`,
            user_id: order.created_by,
            order_item_id: item.id,
            create_movement: true,
            validate_availability: false,
          },
          tx,
        );
      }
    }
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
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      this.logger.debug(`[CashRegister] cr_settings.enabled=${cr_settings?.enabled}`);
      if (!cr_settings?.enabled) return;

      // Find active session for this user
      const session = await this.sessionsService.getActiveSession(user.id);
      this.logger.debug(`[CashRegister] Active session for user ${user.id}: ${session ? `id=${session.id}` : 'NONE'}`);
      if (!session) return;

      const order_id = order?.id;
      const payment_id = payment?.id;
      const amount = Number(payment?.amount || order?.total_amount || 0);
      this.logger.debug(`[CashRegister] order_id=${order_id}, payment_id=${payment_id}, amount=${amount}`);
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

      this.logger.debug(`[CashRegister] payment_method=${payment_method}, track_non_cash=${cr_settings.track_non_cash_payments}`);

      // Only track non-cash if setting enabled
      if (payment_method !== 'cash' && !cr_settings.track_non_cash_payments) {
        this.logger.debug(`[CashRegister] Skipping non-cash movement (tracking disabled)`);
        return;
      }

      await this.movementsService.recordSaleMovement(session.id, {
        store_id: dto.store_id,
        user_id: user.id,
        amount,
        payment_method,
        order_id,
        payment_id,
      });
      this.logger.log(`[CashRegister] Sale movement recorded for session ${session.id}, order ${order_id}`);
    } catch (error) {
      this.logger.error(`[CashRegister] Error recording movement: ${error.message}`, error.stack);
    }
  }
}
