import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderValidationResult } from '../interfaces';

@Injectable()
export class PaymentValidatorService {
  constructor(private prisma: PrismaService) {}

  async validateOrder(
    orderId: number,
    storeId: number,
  ): Promise<OrderValidationResult> {
    try {
      const order = await this.prisma.orders.findUnique({
        where: { id: orderId },
        include: {
          stores: true,
          order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
          payments: {
            orderBy: { created_at: 'desc' },
          },
        },
      });

      if (!order) {
        return {
          valid: false,
          errors: ['Order not found'],
        };
      }

      if (order.store_id !== storeId) {
        return {
          valid: false,
          errors: ['Order does not belong to this store'],
        };
      }

      const errors: string[] = [];
      const warnings: string[] = [];

      if (order.state === 'cancelled') {
        errors.push('Cannot process payment for cancelled order');
      }

      if (order.state === 'refunded') {
        errors.push('Order has already been refunded');
      }

      if (order.state === 'finished') {
        warnings.push('Order is already finished');
      }

      const totalPaid = order.payments
        .filter((p: any) => p.state === 'succeeded' || p.state === 'captured')
        .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

      if (totalPaid >= Number(order.grand_total)) {
        warnings.push('Order is already fully paid');
      }

      if (order.order_items.length === 0) {
        errors.push('Order has no items');
      }

      for (const item of order.order_items) {
        if (item.quantity <= 0) {
          errors.push(`Invalid quantity for product ${item.product_name}`);
        }
      }

      return {
        valid: errors.length === 0,
        order,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        valid: false,
        errors: ['Error validating order: ' + error.message],
      };
    }
  }

  async validatePaymentMethod(
    storePaymentMethodId: number,
    storeId: number,
  ): Promise<boolean> {
    try {
      const paymentMethod = await this.prisma.store_payment_methods.findFirst({
        where: {
          id: storePaymentMethodId,
          store_id: storeId,
          state: 'enabled',
        },
        include: {
          system_payment_method: true,
        },
      });

      if (!paymentMethod) {
        return false;
      }

      // Also validate that the system payment method is active
      if (!paymentMethod.system_payment_method.is_active) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async validatePaymentAmount(
    amount: number,
    orderId: number,
  ): Promise<boolean> {
    try {
      const order = await this.prisma.orders.findUnique({
        where: { id: orderId },
        include: {
          payments: {
            where: {
              state: {
                in: ['succeeded', 'captured', 'pending'],
              },
            },
          },
        },
      });

      if (!order) {
        return false;
      }

      const totalPaid = order.payments.reduce(
        (sum: number, p: any) => sum + Number(p.amount),
        0,
      );
      const remainingAmount = Number(order.grand_total) - totalPaid;

      return amount > 0 && amount <= remainingAmount;
    } catch (error) {
      return false;
    }
  }

  async validateCurrency(currency: string, storeId: number): Promise<boolean> {
    try {
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
      });

      if (!store) {
        return false;
      }

      return currency.length >= 3 && currency.length <= 10;
    } catch (error) {
      return false;
    }
  }

  async validateCustomer(
    customerId: number,
    storeId: number,
  ): Promise<boolean> {
    try {
      const customer = await this.prisma.users.findFirst({
        where: {
          id: customerId,
          organization_id: storeId,
        },
      });

      return !!customer;
    } catch (error) {
      return false;
    }
  }
}
