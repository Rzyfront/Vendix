import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../interfaces';
import { PaymentValidatorService } from './payment-validator.service';
import { PaymentError, PaymentErrorCodes } from '../utils';
import { BasePaymentProcessor } from '../interfaces/base-processor.interface';

@Injectable()
export class PaymentGatewayService {
  private processors: Map<string, BasePaymentProcessor> = new Map();

  constructor(
    private prisma: PrismaService,
    private validatorService: PaymentValidatorService,
  ) {}

  registerProcessor(name: string, processor: BasePaymentProcessor): void {
    this.processors.set(name, processor);
  }

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      await this.validatePaymentData(paymentData);

      const paymentMethod = await this.getPaymentMethod(
        paymentData.paymentMethodId,
      );
      const processor = this.getProcessor(paymentMethod.type);

      if (!processor.isEnabled()) {
        throw new PaymentError(
          PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
          'Payment method is disabled',
        );
      }

      const payment = await this.createPaymentRecord(
        paymentData,
        paymentMethod.type,
      );

      const result = await processor.processPayment({
        ...paymentData,
        metadata: {
          ...paymentData.metadata,
          paymentId: payment.id,
        },
      });

      await this.updatePaymentRecord(payment.id, result);

      if (result.success) {
        await this.updateOrderStatus(paymentData.orderId);
      }

      return {
        ...result,
        transactionId: result.transactionId || payment.transaction_id,
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(PaymentErrorCodes.PROCESSOR_ERROR, error.message);
    }
  }

  async processPaymentWithNewOrder(
    paymentData: PaymentData & {
      customerEmail: string;
      customerName: string;
      customerPhone?: string;
      items: any[];
      billingAddressId?: number;
      shippingAddressId?: number;
    },
  ): Promise<PaymentResult> {
    try {
      const order = await this.createOrderFromPaymentData(paymentData);

      return this.processPayment({
        ...paymentData,
        orderId: order.id,
      });
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(PaymentErrorCodes.INVALID_ORDER, error.message);
    }
  }

  async refundPayment(
    paymentId: string,
    amount?: number,
    reason?: string,
  ): Promise<RefundResult> {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: paymentId },
        include: { payment_methods: true },
      });

      if (!payment) {
        throw new PaymentError(
          PaymentErrorCodes.INVALID_ORDER,
          'Payment not found',
        );
      }

      if (payment.state !== 'succeeded' && payment.state !== 'captured') {
        throw new PaymentError(
          PaymentErrorCodes.VALIDATION_FAILED,
          'Payment cannot be refunded',
        );
      }

      const processor = this.getProcessor(
        payment.payment_methods?.type || 'card',
      );
      const result = await processor.refundPayment(paymentId, amount);

      if (result.success) {
        await this.createRefundRecord(payment.id, result, reason);
        await this.updateOrderAfterRefund(payment.order_id);
      }

      return result;
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(PaymentErrorCodes.PROCESSOR_ERROR, error.message);
    }
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: transactionId },
        include: { payment_methods: true },
      });

      if (!payment) {
        throw new PaymentError(
          PaymentErrorCodes.INVALID_ORDER,
          'Payment not found',
        );
      }

      const processor = this.getProcessor(
        payment.payment_methods?.type || 'card',
      );
      return await processor.getPaymentStatus(transactionId);
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(PaymentErrorCodes.PROCESSOR_ERROR, error.message);
    }
  }

  private async validatePaymentData(paymentData: PaymentData): Promise<void> {
    const [orderValid, methodValid, amountValid, currencyValid] =
      await Promise.all([
        this.validatorService.validateOrder(
          paymentData.orderId,
          paymentData.storeId,
        ),
        this.validatorService.validatePaymentMethod(
          paymentData.paymentMethodId,
          paymentData.storeId,
        ),
        this.validatorService.validatePaymentAmount(
          paymentData.amount,
          paymentData.orderId,
        ),
        this.validatorService.validateCurrency(
          paymentData.currency,
          paymentData.storeId,
        ),
      ]);

    if (!orderValid.valid) {
      throw new PaymentError(
        PaymentErrorCodes.INVALID_ORDER,
        orderValid.errors?.join(', ') || 'Invalid order',
      );
    }

    if (!methodValid) {
      throw new PaymentError(
        PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
        'Payment method is not valid or enabled',
      );
    }

    if (!amountValid) {
      throw new PaymentError(
        PaymentErrorCodes.INVALID_AMOUNT,
        'Invalid payment amount',
      );
    }

    if (!currencyValid) {
      throw new PaymentError(
        PaymentErrorCodes.CURRENCY_NOT_SUPPORTED,
        'Currency not supported',
      );
    }
  }

  private async getPaymentMethod(paymentMethodId: number) {
    const paymentMethod = await this.prisma.payment_methods.findUnique({
      where: { id: paymentMethodId },
    });

    if (!paymentMethod) {
      throw new PaymentError(
        PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
        'Payment method not found',
      );
    }

    return paymentMethod;
  }

  private getProcessor(type: string): BasePaymentProcessor {
    const processor = this.processors.get(type);
    if (!processor) {
      throw new PaymentError(
        PaymentErrorCodes.PROCESSOR_ERROR,
        `Payment processor not found for type: ${type}`,
      );
    }
    return processor;
  }

  private async createPaymentRecord(
    paymentData: PaymentData,
    processorType: string,
  ) {
    return await this.prisma.payments.create({
      data: {
        order_id: paymentData.orderId,
        customer_id: paymentData.customerId,
        payment_method_id: paymentData.paymentMethodId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        state: 'pending',
        transaction_id: `${processorType}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        gateway_response: paymentData.metadata,
      },
    });
  }

  private async updatePaymentRecord(paymentId: number, result: PaymentResult) {
    const updateData: any = {
      state: result.status,
      gateway_response: result.gatewayResponse,
      updated_at: new Date(),
    };

    if (
      result.success &&
      (result.status === 'succeeded' || result.status === 'captured')
    ) {
      updateData.paid_at = new Date();
    }

    if (result.transactionId) {
      updateData.transaction_id = result.transactionId;
    }

    await this.prisma.payments.update({
      where: { id: paymentId },
      data: updateData,
    });
  }

  private async updateOrderStatus(orderId: number) {
    const order = await this.prisma.orders.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order) return;

    const totalPaid = order.payments
      .filter((p: any) => p.state === 'succeeded' || p.state === 'captured')
      .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

    let newState = order.state;

    if (totalPaid >= Number(order.grand_total)) {
      if (order.state === 'created' || order.state === 'pending_payment') {
        newState = 'processing';
      }
    } else if (totalPaid > 0) {
      if (order.state === 'created') {
        newState = 'pending_payment';
      }
    }

    if (newState !== order.state) {
      await this.prisma.orders.update({
        where: { id: orderId },
        data: {
          state: newState,
          updated_at: new Date(),
        },
      });
    }
  }

  private async createOrderFromPaymentData(paymentData: any) {
    const orderNumber = await this.generateOrderNumber();

    return await this.prisma.orders.create({
      data: {
        customer_id: paymentData.customerId,
        store_id: paymentData.storeId,
        order_number: orderNumber,
        state: 'created',
        subtotal_amount: paymentData.items.reduce(
          (sum: number, item: any) => sum + item.totalPrice,
          0,
        ),
        tax_amount: paymentData.items.reduce(
          (sum: number, item: any) => sum + (item.taxAmountItem || 0),
          0,
        ),
        shipping_cost: 0,
        discount_amount: 0,
        grand_total: paymentData.amount,
        currency: paymentData.currency,
        billing_address_id: paymentData.billingAddressId,
        shipping_address_id: paymentData.shippingAddressId,
        order_items: {
          create: paymentData.items.map((item: any) => ({
            product_id: item.productId,
            product_variant_id: item.productVariantId,
            product_name: item.productName,
            variant_sku: item.variantSku,
            variant_attributes: item.variantAttributes,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            tax_rate: item.taxRate,
            tax_amount_item: item.taxAmountItem,
            updated_at: new Date(),
          })),
        },
      },
    });
  }

  private async createRefundRecord(
    paymentId: number,
    result: RefundResult,
    reason?: string,
  ) {
    return await this.prisma.refunds.create({
      data: {
        payment_id: paymentId,
        amount: result.amount,
        reason: reason || 'Customer request',
        status: result.status,
        refund_id: result.refundId,
        gateway_response: result.gatewayResponse,
      },
    });
  }

  private async updateOrderAfterRefund(orderId: number) {
    const order = await this.prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        refunds: true,
      },
    });

    if (!order) return;

    const totalPaid = order.payments
      .filter((p: any) => p.state === 'succeeded' || p.state === 'captured')
      .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

    const totalRefunded = order.refunds
      .filter((r: any) => r.status === 'succeeded')
      .reduce((sum: number, r: any) => sum + Number(r.amount), 0);

    const netAmount = totalPaid - totalRefunded;

    if (netAmount <= 0 && totalRefunded > 0) {
      await this.prisma.orders.update({
        where: { id: orderId },
        data: {
          state: 'refunded',
          updated_at: new Date(),
        },
      });
    }
  }

  private async generateOrderNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const lastOrder = await this.prisma.orders.findFirst({
      where: { order_number: { startsWith: `ORD${year}${month}${day}` } },
      orderBy: { order_number: 'desc' },
    });
    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `ORD${year}${month}${day}${sequence.toString().padStart(4, '0')}`;
  }
}
