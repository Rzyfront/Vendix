import { Injectable, Optional, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { SplitAccountPayDto, ConfirmSplitAccountPaymentDto } from './dto/split-order.dto';
import { PaymentGatewayService } from '../payments/services/payment-gateway.service';

@Injectable()
export class SplitAccountPaymentService {
  constructor(
    private readonly prisma: StorePrismaService,
    @Optional() @Inject(forwardRef(() => PaymentGatewayService))
    private readonly paymentGatewayService?: PaymentGatewayService,
  ) {}

  private context() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id || !ctx.organization_id || !ctx.user_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return ctx;
  }

  async reconcileReceivedForOrder(orderId: number): Promise<void> {
    const { store_id } = this.context();
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id },
      include: {
        active_financial_split: {
          include: { accounts: { include: { payments: true } } },
        },
      },
    });
    if (!order?.active_financial_split) return;

    for (const account of order.active_financial_split.accounts) {
      if (account.role !== 'payable') continue;
      const paid = (account.payments ?? [])
        .filter((p) => ['succeeded', 'captured'].includes(p.state))
        .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
      if (!account.paid_snapshot.equals(paid)) {
        await this.prisma.order_financial_accounts.update({
          where: { id: account.id },
          data: { paid_snapshot: paid },
        });
      }
    }
  }

  async pay(orderId: number, accountId: number, dto: SplitAccountPayDto): Promise<any> {
    const { store_id } = this.context();
    const account = await this.prisma.order_financial_accounts.findFirst({
      where: { id: accountId, store_id, state: 'active' },
      include: {
        split: { include: { source_order: true } },
      },
    });
    if (!account || account.split.source_order_id !== orderId) {
      throw new VendixHttpException(
        ErrorCodes.SPLIT_ORDER_NOT_FOUND,
        'La cuenta financiera no pertenece a esta orden.',
      );
    }

    const idempotencyKey = dto.idempotency_key || `split_${accountId}_${Date.now()}`;

    const existing = await this.prisma.payments.findFirst({
      where: { financial_idempotency_key: idempotencyKey },
    });
    if (existing) return existing;

    const payment = await this.prisma.payments.create({
      data: {
        order_id: orderId,
        customer_id: account.customer_id,
        financial_account_id: accountId,
        financial_idempotency_key: idempotencyKey,
        store_payment_method_id: dto.store_payment_method_id,
        amount: new Prisma.Decimal(dto.amount),
        state: 'pending',
        currency: account.split.source_order.currency || 'COP',
      },
    });

    if (this.paymentGatewayService) {
      try {
        return await this.paymentGatewayService.processReservedPayment(payment.id);
      } catch {
        // Fallback for offline/manual payment methods
      }
    }

    return this.prisma.payments.update({
      where: { id: payment.id },
      data: {
        state: 'succeeded',
        paid_at: new Date(),
      },
    });
  }

  async confirm(
    orderId: number,
    accountId: number,
    paymentId: number,
    dto: ConfirmSplitAccountPaymentDto,
  ): Promise<any> {
    const payment = await this.prisma.payments.findFirst({
      where: { id: paymentId, order_id: orderId, financial_account_id: accountId },
    });
    if (!payment) {
      throw new NotFoundException('Pago no encontrado.');
    }

    const updated = await this.prisma.payments.update({
      where: { id: paymentId },
      data: {
        state: 'succeeded',
        paid_at: new Date(),
        ...(dto.payment_reference ? { gateway_reference: dto.payment_reference } : {}),
      },
    });

    await this.reconcileReceivedForOrder(orderId);
    return updated;
  }
}
