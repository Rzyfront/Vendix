import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, refunds_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
  ResolvedBankAccount,
} from '../interfaces';
import { PaymentValidatorService } from './payment-validator.service';
import { PaymentError, PaymentErrorCodes } from '../utils';
import { BasePaymentProcessor } from '../interfaces/base-processor.interface';

@Injectable()
export class PaymentGatewayService {
  private processors: Map<string, BasePaymentProcessor> = new Map();

  constructor(
    private prisma: StorePrismaService,
    private validatorService: PaymentValidatorService,
  ) {}

  registerProcessor(name: string, processor: BasePaymentProcessor): void {
    this.processors.set(name, processor);
  }

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      // The store/POS/eCommerce path through this service requires a
      // resolved store_payment_methods.id. SaaS subscription billing has
      // its own gateway path that resolves the method itself; the typed
      // optionality on PaymentData accommodates both shapes, but here we
      // hard-require it.
      if (!paymentData.storePaymentMethodId) {
        throw new PaymentError(
          PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
          'storePaymentMethodId is required for store/POS/eCommerce payments',
        );
      }

      await this.validatePaymentData(paymentData);

      const paymentMethod = await this.getPaymentMethod(
        paymentData.storePaymentMethodId,
      );
      const processor = this.getProcessor(
        paymentMethod.system_payment_method?.type || paymentMethod.type,
      );

      if (!processor.isEnabled()) {
        throw new PaymentError(
          PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
          'Payment method is disabled',
        );
      }

      // QUI-728 — resuelve y valida la cuenta bancaria ANTES de invocar al
      // processor (existe + activa + organización + scope de tienda) y le pasa
      // el objeto ya resuelto, no el id. Ver ADR-3 / ERR-04: validar solo a
      // nivel de organización dejaría pagar desde la Tienda B contra una cuenta
      // de la Tienda A en un negocio multi-local.
      let effectivePaymentData = paymentData;
      if (paymentData.bankAccountId) {
        const bankAccount = await this.resolveAndValidateBankAccount(
          paymentData.bankAccountId,
          paymentData.storeId,
        );
        effectivePaymentData = { ...paymentData, bankAccount };
      }

      const payment = await this.createPaymentRecord(
        effectivePaymentData,
        paymentMethod.system_payment_method?.type || 'unknown',
      );

      // Back-compat: legacy callers (existing eCommerce/POS DTOs) may not pass
      // an idempotency key yet. Initialize a fresh UUID so the processor's
      // provider call is still safe within this single attempt. Callers that
      // need cross-attempt safety on retries MUST pass a stable key.
      const idempotencyKey =
        effectivePaymentData.idempotencyKey &&
        effectivePaymentData.idempotencyKey.length > 0
          ? effectivePaymentData.idempotencyKey
          : crypto.randomUUID();

      const result = await processor.processPayment({
        ...effectivePaymentData,
        idempotencyKey,
        metadata: {
          ...effectivePaymentData.metadata,
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
      const result = await this.reversePaymentWithProcessor(
        paymentId,
        amount,
      );

      if (result.success) {
        const payment = await this.prisma.payments.findFirst({
          where: { transaction_id: paymentId },
          select: { id: true, order_id: true },
        });

        if (payment) {
          await this.createRefundRecord(payment, result, reason);
          await this.updateOrderAfterRefund(payment.order_id);
        }
      }

      return result;
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(PaymentErrorCodes.PROCESSOR_ERROR, error.message);
    }
  }

  /**
   * Performs the processor-side reversal against the gateway without touching
   * the `refunds` or `orders` tables. Resolves the processor by following
   * `payments → store_payment_method → system_payment_method.type`, validates
   * that the payment is in a refundable state, and delegates to
   * `processor.refundPayment(...)`.
   *
   * Separated from the public `refundPayment()` flow (ADR-1, CP-refund-gateway-
   * dispatch-fix) so callers that already own the `refunds` row in their own
   * transaction (e.g. `RefundFlowService.dispatchRefundProcessor`) can call
   * the processor without triggering a duplicate `createRefundRecord`.
   *
   * Errors thrown:
   * - `PaymentError(INVALID_ORDER)` — payment not found.
   * - `PaymentError(VALIDATION_FAILED)` — payment is not in a refundable state.
   * - `PaymentError(PROCESSOR_ERROR)` — processor lookup failed or processor
   *   call rejected with a non-PaymentError exception.
   * - Raw exceptions from the processor call propagate unchanged; callers that
   *   want a uniform contract should wrap the call in their own try/catch.
   */
  public async reversePaymentWithProcessor(
    transactionId: string,
    amount?: number,
  ): Promise<RefundResult> {
    const payment = await this.prisma.payments.findFirst({
      where: { transaction_id: transactionId },
      include: {
        store_payment_method: { include: { system_payment_method: true } },
      },
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
      payment.store_payment_method?.system_payment_method?.type || 'card',
    );
    return await processor.refundPayment(transactionId, amount);
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: transactionId },
        include: {
          store_payment_method: { include: { system_payment_method: true } },
        },
      });

      if (!payment) {
        throw new PaymentError(
          PaymentErrorCodes.INVALID_ORDER,
          'Payment not found',
        );
      }

      const processor = this.getProcessor(
        payment.store_payment_method?.system_payment_method?.type || 'card',
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
    // Skip order validation for POS payments — the order was just created
    // inside the same Prisma transaction and isn't visible to the regular client yet
    const skipOrderValidation = paymentData.metadata?.is_pos_payment === true;

    const validations: Promise<any>[] = [
      skipOrderValidation
        ? Promise.resolve({ valid: true })
        : this.validatorService.validateOrder(
            paymentData.orderId,
            paymentData.storeId,
          ),
      this.validatorService.validatePaymentMethod(
        paymentData.storePaymentMethodId as number,
        paymentData.storeId,
      ),
      skipOrderValidation
        ? Promise.resolve(true)
        : this.validatorService.validatePaymentAmount(
            paymentData.amount,
            paymentData.orderId,
          ),
      this.validatorService.validateCurrency(
        paymentData.currency,
        paymentData.storeId,
      ),
    ];

    const [orderValid, methodValid, amountValid, currencyValid] =
      await Promise.all(validations);

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
    const paymentMethod = await this.prisma.store_payment_methods.findUnique({
      where: { id: paymentMethodId },
      include: {
        system_payment_method: true,
      },
    });

    if (!paymentMethod) {
      throw new PaymentError(
        PaymentErrorCodes.PAYMENT_METHOD_DISABLED,
        'Payment method not found or disabled',
      );
    }

    return paymentMethod;
  }

  /**
   * QUI-728 / ADR-3 — resuelve y valida una cuenta bancaria de destino antes de
   * invocar al processor de transferencia. Comprueba que:
   *   1. exista;
   *   2. `status === 'active'`;
   *   3. pertenezca a la ORGANIZACIÓN de la tienda del contexto;
   *   4. `store_id === null` (cuenta de la organización) o `=== store_id`
   *      (cuenta de la tienda). Validar solo a nivel de org permitiría cobrar
   *      desde la Tienda B contra una cuenta de la Tienda A.
   *
   * `client` es un parámetro opcional para permitir la misma validación dentro
   * de una transacción POS (`tx`) desde `PaymentsService`. Devuelve la proyección
   * mínima `{ id, name, bank_name, account_number, currency }` — nunca el id sin
   * validar, ni expone `current_balance` / `opening_balance`.
   */
  async resolveAndValidateBankAccount(
    bankAccountId: number,
    storeId: number,
    client: StorePrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<ResolvedBankAccount> {
    const account = await client.bank_accounts.findFirst({
      where: { id: bankAccountId },
    });

    if (!account) {
      throw new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria seleccionada no existe',
      );
    }

    if (account.status !== 'active') {
      throw new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria seleccionada no está activa',
      );
    }

    const store = await client.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });

    if (!store) {
      throw new PaymentError(
        PaymentErrorCodes.INVALID_ORDER,
        'Tienda no encontrada para la cuenta bancaria',
      );
    }

    if (account.organization_id !== store.organization_id) {
      throw new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria no pertenece a la organización de esta tienda',
      );
    }

    if (account.store_id !== null && account.store_id !== storeId) {
      throw new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria no pertenece a esta tienda',
      );
    }

    return {
      id: account.id,
      name: account.name,
      bank_name: account.bank_name,
      account_number: account.account_number,
      currency: account.currency,
    };
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
        store_payment_method_id: paymentData.storePaymentMethodId,
        // QUI-728 — cuenta bancaria de destino (bank_transfer). Nullable para
        // no romper los métodos sin cuenta (cash, card, wompi, wallet).
        bank_account_id: paymentData.bankAccountId ?? null,
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

    // Persist the Vendix-generated reference (e.g. Wompi `vendix_<storeId>_<orderId>_<ts>`)
    // so that webhook arrivals carrying `txn.reference` can find the payment row
    // BEFORE we know the real gateway transaction id. Critical for the Wompi flow.
    if (result.gatewayReference) {
      updateData.gateway_reference = result.gatewayReference;
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
    const orderNumber = await this.generateOrderNumber(paymentData.storeId);

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

  /**
   * Persiste el reembolso devuelto por la pasarela.
   *
   * Este método escribía cuatro campos que no existen en `refunds` y omitía dos
   * obligatorios, así que TODO reembolso con éxito en la pasarela moría después
   * con un `PrismaClientValidationError`: el dinero se devolvía al cliente y
   * Vendix no guardaba el registro. El mapeo correcto es:
   *
   * | lo que se escribía | columna real            |
   * |--------------------|-------------------------|
   * | `status`           | `state` (`refunds_state_enum`) |
   * | `refund_id`        | `refund_transaction_id` |
   * | `gateway_response` | `gateway_response` (columna nueva, `Json?`) |
   * | —                  | `order_id` (obligatorio) |
   *
   * `RefundResult.status` es `'succeeded' | 'failed' | 'pending'`, que NO son
   * valores de `refunds_state_enum`; escribirlo tal cual habría seguido
   * fallando aun con el nombre de columna corregido.
   */
  private async createRefundRecord(
    payment: { id: number; order_id: number },
    result: RefundResult,
    reason?: string,
  ) {
    const REFUND_STATE: Record<RefundResult['status'], refunds_state_enum> = {
      succeeded: refunds_state_enum.completed,
      failed: refunds_state_enum.failed,
      pending: refunds_state_enum.processing,
    };

    return await this.prisma.refunds.create({
      data: {
        order_id: payment.order_id,
        payment_id: payment.id,
        amount: result.amount,
        reason: reason || 'Customer request',
        state: REFUND_STATE[result.status] ?? refunds_state_enum.processing,
        refund_transaction_id: result.refundId ?? null,
        gateway_response: result.gatewayResponse ?? Prisma.JsonNull,
        processed_at: result.status === 'succeeded' ? new Date() : null,
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

  private async generateOrderNumber(storeId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `ORD${year}${month}${day}`;

    const lastOrder = await this.prisma.orders.findFirst({
      where: {
        store_id: storeId,
        order_number: { startsWith: prefix },
      },
      orderBy: { order_number: 'desc' },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
