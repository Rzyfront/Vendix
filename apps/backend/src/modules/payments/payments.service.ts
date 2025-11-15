import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayService } from './services/payment-gateway.service';
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
    private prisma: PrismaService,
    private paymentGateway: PaymentGatewayService,
  ) {}

  async processPayment(createPaymentDto: CreatePaymentDto, user: any) {
    try {
      await this.validateUserAccess(user, createPaymentDto.storeId);

      const result = await this.paymentGateway.processPayment({
        orderId: createPaymentDto.orderId,
        customerId: createPaymentDto.customerId,
        amount: createPaymentDto.amount,
        currency: createPaymentDto.currency,
        paymentMethodId: createPaymentDto.paymentMethodId,
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
        paymentMethodId: createOrderPaymentDto.paymentMethodId,
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

    if (storeId) {
      where.orders = {
        store_id: storeId,
      };
    } else {
      where.orders = {
        store_id: {
          in: await this.getUserStoreIds(user),
        },
      };
    }

    if (paymentMethodType) {
      where.payment_methods = {
        type: paymentMethodType,
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
        payment_methods: true,
        refunds: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.validateUserAccess(user, payment.orders.stores.id);

    return {
      data: payment,
    };
  }

  private async validateUserAccess(user: any, storeId: number): Promise<void> {
    const userStoreIds = await this.getUserStoreIds(user);

    if (!userStoreIds.includes(storeId)) {
      throw new ForbiddenException('Access denied to this store');
    }
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
        let payment = null;
        if (createPosPaymentDto.requires_payment) {
          payment = await this.processPosPaymentTransaction(
            tx,
            order,
            createPosPaymentDto,
          );
          await this.updateOrderPaymentStatus(tx, order.id, 'paid');
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
          console.log(
            'Email confirmation would be sent to:',
            createPosPaymentDto.customer_email,
          );
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
            payment_status: order.payment_status,
            total_amount: order.grand_total,
          },
          payment: payment
            ? {
                id: (payment as any).id,
                amount: (payment as any).amount,
                payment_method:
                  (payment as any).payment_methods?.name || 'Unknown',
                status: (payment as any).status,
                transaction_id: (payment as any).transaction_id,
                change: (payment as any).change,
              }
            : undefined,
        };
      });
    } catch (error) {
      console.error('Error processing POS payment:', error);
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
    // Generate order number if not provided
    const orderNumber = await this.generateOrderNumber(tx);

    // Create order items
    const orderItems = dto.items.map((item) => ({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      product_name: item.product_name,
      product_sku: item.product_sku,
      variant_sku: item.variant_sku,
      variant_attributes: item.variant_attributes,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      tax_rate: item.tax_rate,
      tax_amount_item: item.tax_amount_item,
      cost: item.cost,
      notes: item.notes,
    }));

    // Create the order
    const order = await tx.orders.create({
      data: {
        customer_id: dto.customer_id,
        store_id: dto.store_id,
        order_number: orderNumber,
        state: 'confirmed',
        payment_status: dto.requires_payment ? 'pending' : 'pending_payment',
        subtotal_amount: dto.subtotal,
        tax_amount: dto.tax_amount || 0,
        discount_amount: dto.discount_amount || 0,
        grand_total: dto.total_amount,
        currency: dto.currency || 'USD',
        billing_address_id: dto.billing_address_id,
        shipping_address_id: dto.shipping_address_id,
        internal_notes: dto.internal_notes,
        created_by: user.id,
        order_items: {
          create: orderItems,
        },
      },
      include: {
        order_items: true,
        stores: true,
      },
    });

    return order;
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
    const paymentMethod = await tx.payment_methods.findFirst({
      where: { id: dto.payment_method_id },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    // Calculate change for cash payments
    let change = 0;
    if (paymentMethod.type === 'cash' && dto.amount_received) {
      change = dto.amount_received - dto.total_amount;
    }

    // Create payment record
    const payment = await tx.payments.create({
      data: {
        order_id: order.id,
        payment_method_id: dto.payment_method_id,
        amount: dto.total_amount,
        currency: dto.currency || 'USD',
        status: 'succeeded',
        transaction_id: await this.generateTransactionId(),
        reference: dto.payment_reference,
        change: change,
        metadata: {
          register_id: dto.register_id,
          seller_user_id: dto.seller_user_id,
          amount_received: dto.amount_received,
          is_pos_payment: true,
        },
      },
      include: {
        payment_methods: true,
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
    status: string,
  ) {
    await tx.orders.update({
      where: { id: orderId },
      data: {
        payment_status: status,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Update inventory from order
   */
  private async updateInventoryFromOrder(tx: any, order: any) {
    for (const item of order.order_items) {
      // Update product stock
      await tx.products.update({
        where: { id: item.product_id },
        data: {
          stock_quantity: {
            decrement: item.quantity,
          },
        },
      });

      // Create inventory movement
      await tx.inventory_movements.create({
        data: {
          product_id: item.product_id,
          store_id: order.store_id,
          movement_type: 'out',
          quantity: item.quantity,
          reference_type: 'order',
          reference_id: order.id,
          notes: `POS Sale - Order ${order.order_number}`,
        },
      });
    }
  }

  /**
   * Generate unique order number
   */
  private async generateOrderNumber(tx: any): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();

    // Find the last order number for this year
    const lastOrder = await tx.orders.findFirst({
      where: {
        order_number: {
          startsWith: `POS-${year}`,
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

    return `POS-${year}-${sequence.toString().padStart(4, '0')}`;
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
}
