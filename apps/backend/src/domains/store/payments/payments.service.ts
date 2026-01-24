import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { PaymentGatewayService } from './services/payment-gateway.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
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
import { PaymentError, PaymentErrorCodes } from './utils';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: StorePrismaService,
    private paymentGateway: PaymentGatewayService,
    private stockLevelManager: StockLevelManager,
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
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
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
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
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
        throw new NotFoundException('Payment not found');
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
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
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
        throw new NotFoundException('Payment not found');
      }

      await this.validateUserAccess(user, payment.orders.stores.id);

      const status = await this.paymentGateway.getPaymentStatus(paymentId);

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
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
      throw new NotFoundException('Payment not found');
    }

    // Check if user has access to this payment's store
    // The payment is linked to an order, which is linked to a store
    if (payment.orders && payment.orders.store_id) {
      await this.validateUserAccess(user, payment.orders.store_id);
    } else {
      // If for some reason order linkage is missing (should not happen)
      // For safety, only super_admin should access orphaned records
      if (!user.roles || !user.roles.includes('super_admin')) {
        throw new ForbiddenException('Access denied to this payment record');
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
    throw new ForbiddenException('Access denied to this store');
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

      return await this.prisma.$transaction(async (tx) => {
        // 1. Create or update order
        const order = await this.createOrUpdateOrderFromPos(
          tx,
          createPosPaymentDto,
          user,
        );

        // 2. Process payment if required
        let payment: any = null;
        if (createPosPaymentDto.requires_payment) {
          payment = await this.processPosPaymentTransaction(
            tx,
            order,
            createPosPaymentDto,
          );
          await this.updateOrderPaymentStatus(tx, order.id, 'succeeded');
        } else {
          // Credit sale - update order status
          await this.updateOrderPaymentStatus(tx, order.id, 'pending_payment');
        }

        // 3. Update inventory if required
        if (createPosPaymentDto.update_inventory) {
          await this.updateInventoryFromOrder(tx, order);
        }

        // 4. Send confirmation if required
        if (createPosPaymentDto.send_email_confirmation) {
          // TODO: Implement email confirmation
        }

        return {
          success: true,
          message: createPosPaymentDto.requires_payment
            ? 'Payment processed successfully'
            : 'Order created successfully (credit sale)',
          order: {
            id: order.id,
            order_number: order.order_number,
            status: order.state,
            payment_status: payment ? payment.state : 'pending',
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
              }
            : undefined,
        };
      });
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error processing payment',
        errors: [error.message],
      };
    }
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
        const orderItems = dto.items.map((item) => {
          const orderItem: any = {
            product_name: item.product_name,
            variant_sku: item.product_sku, // Mapear product_sku del frontend a variant_sku del backend
            variant_attributes: item.variant_attributes
              ? JSON.stringify(item.variant_attributes)
              : undefined,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
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
        });

        // Build order data - only include customer_id if provided (for anonymous sales)
        const orderData: any = {
          store_id: dto.store_id,
          order_number: orderNumber,
          state: 'processing', // Match enum order_state_enum
          subtotal_amount: dto.subtotal,
          tax_amount: dto.tax_amount || 0,
          discount_amount: dto.discount_amount || 0,
          grand_total: dto.total_amount,
          currency: dto.currency || 'USD',
          billing_address_id: dto.billing_address_id,
          shipping_address_id: dto.shipping_address_id,
          internal_notes: dto.internal_notes,
          order_items: {
            create: orderItems,
          },
        };

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
        currency: dto.currency || 'USD',
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
   * Update order payment status
   */
  private async updateOrderPaymentStatus(
    tx: any,
    orderId: number,
    paymentState: string,
  ) {
    // Update order state based on payment state
    let orderState: string;
    switch (paymentState) {
      case 'succeeded':
        orderState = 'processing';
        break;
      case 'pending':
        orderState = 'pending_payment';
        break;
      case 'failed':
        orderState = 'created';
        break;
      case 'refunded':
        orderState = 'refunded';
        break;
      default:
        orderState = 'processing';
    }

    await tx.orders.update({
      where: { id: orderId },
      data: {
        state: orderState,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Update inventory from order
   */
  private async updateInventoryFromOrder(tx: any, order: any) {
    // Get default location for the store
    // Since LocationsService is not injected, we do a direct query or rely on StockLevelManager finding the stock
    // Ideally we should have the location in the order or item context, but for POS default location is usually implied if not set.
    // We can check if the store has a default location.

    const defaultLocation = await tx.inventory_locations.findFirst({
      where: {
        store_id: order.store_id,
        is_active: true,
      },
      orderBy: { id: 'asc' }, // Pick the first one as default
    });

    if (!defaultLocation) {
      return;
    }

    for (const item of order.order_items) {
      await this.stockLevelManager.updateStock(
        {
          product_id: item.product_id,
          variant_id: item.product_variant_id,
          location_id: defaultLocation.id,
          quantity_change: -item.quantity, // Decrease stock
          movement_type: 'sale',
          reason: `POS Sale - Order ${order.order_number}`,
          user_id: order.created_by,
          order_item_id: item.id,
          create_movement: true,
          validate_availability: true, // Enforce stock limits
        },
        tx, // Pass the transaction client
      );
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
}
