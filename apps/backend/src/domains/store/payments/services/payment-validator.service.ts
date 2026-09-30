import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OrderValidationResult } from '../interfaces';
import { ErrorCodes } from '../../../../common/errors/error-codes';

type TypedOrderValidationResult = OrderValidationResult & { errorCode?: string };

type MonetaryValue = Prisma.Decimal | number | string;
type OrderSettlementSnapshot = {
  grand_total: MonetaryValue | null | undefined;
  payments?: ReadonlyArray<{ state: string; amount: MonetaryValue }>;
  refunds?: ReadonlyArray<{ state: string; amount: MonetaryValue }>;
};

/** Shared, exact-money settlement check for POS and the locked order-pay path.
 *
 * Step 2 (CP-REFUND-FLOW-REDESIGN): `partially_refunded`/`refunded` face
 * values count as settled — the `amount` column keeps the money that
 * arrived, and what left via refunds discounts the OWED side (see
 * `isOrderFullyPaid`), never here. Dropping refunded-state legs from this
 * sum is what let a refunded order look unpaid and accept a re-charge.
 */
export function getSettledOrderAmount(
  order: Pick<OrderSettlementSnapshot, 'payments'>,
): Prisma.Decimal {
  return (order.payments ?? [])
    .filter((payment) =>
      payment.state === 'succeeded' ||
      payment.state === 'captured' ||
      payment.state === 'partially_refunded' ||
      payment.state === 'refunded',
    )
    .reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
}

/** Step 2 (CP-REFUND-FLOW-REDESIGN) — fiscal-aware refund discount. Only
 * `completed` refunds count: they are the money that actually left the
 * store. Pending/failed rows never moved money and must not reduce the
 * owed total. Absent `refunds` (callers that do not include the relation)
 * discounts zero — which preserves the pre-step-2 verdict ONLY for orders
 * without completed refunds; for refunded legs the discount IS the
 * intended step-2 fix (see the payOrder invariant in order-flow.service).
 */
export function getCompletedRefundAmount(
  order: Pick<OrderSettlementSnapshot, 'refunds'>,
): Prisma.Decimal {
  return (order.refunds ?? [])
    .filter((refund) => refund.state === 'completed')
    .reduce(
      (sum, refund) => sum.plus(refund.amount),
      new Prisma.Decimal(0),
    );
}

export function isOrderFullyPaid(
  order: OrderSettlementSnapshot,
  settledAmount = getSettledOrderAmount(order),
): boolean {
  const owed = new Prisma.Decimal(order.grand_total ?? 0).minus(
    getCompletedRefundAmount(order),
  );
  return settledAmount.gte(owed);
}

@Injectable()
export class PaymentValidatorService {
  constructor(private prisma: StorePrismaService) {}

  async validateOrder(
    orderId: number,
    storeId: number,
  ): Promise<TypedOrderValidationResult> {
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
          // Step 2 (CP-REFUND-FLOW-REDESIGN): `isOrderFullyPaid` discounts
          // completed refunds from the owed total — without this include
          // the discount would silently read zero here.
          refunds: {
            where: { state: 'completed' },
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

      const alreadyPaid = isOrderFullyPaid(order);

      if (alreadyPaid) {
        errors.push('Order is already fully paid');
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
        ...(alreadyPaid && {
          errorCode: ErrorCodes.ORD_PAY_ALREADY_PAID_001.code,
        }),
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
    excludedPaymentId?: number,
  ): Promise<boolean> {
    try {
      const order = await this.prisma.orders.findUnique({
        where: { id: orderId },
        include: {
          payments: {
            where: {
              ...(excludedPaymentId ? { id: { not: excludedPaymentId } } : {}),
              state: {
                in: ['succeeded', 'captured', 'pending', 'authorized'],
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
