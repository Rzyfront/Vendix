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

  private async getUserStoreIds(user: any): Promise<number[]> {
    const storeUsers = await this.prisma.store_users.findMany({
      where: { user_id: user.id },
      select: { store_id: true },
    });

    return storeUsers.map((su: any) => su.store_id);
  }
}
