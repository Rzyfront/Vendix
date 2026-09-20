import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma, payments_state_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { buildTaxBreakdown } from '@common/interfaces/tax-breakdown.interface';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes, FinancialSplitErrors } from 'src/common/errors';
import { PaymentGatewayService } from '../payments/services/payment-gateway.service';
import { SettingsService } from '../settings/settings.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { TableSessionsService } from './table-sessions.service';
import { SplitOrderService } from './split-order.service';
import { SplitAccountPayDto, ConfirmSplitAccountPaymentDto } from './dto/split-order.dto';

const RECEIVED: payments_state_enum[] = ['succeeded', 'captured'];
const BUDGETED: payments_state_enum[] = [...RECEIVED, 'pending', 'authorized'];
const MANUAL_METHODS = ['cash', 'card', 'bank_transfer'];
const money = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

/**
 * Reserves account AND source capacity under the same source row lock.
 * Provider I/O is strictly post-commit and delegated to the canonical gateway.
 */
@Injectable()
export class SplitAccountPaymentService {
  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(forwardRef(() => PaymentGatewayService)) private readonly gateway: PaymentGatewayService,
    private readonly splitOrders: SplitOrderService,
    private readonly events: EventEmitter2,
    private readonly settings: SettingsService,
    private readonly sessions: SessionsService,
    private readonly tableSessions: TableSessionsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private context() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id || !ctx.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { ...ctx, store_id: ctx.store_id, organization_id: ctx.organization_id, user_id: ctx.user_id };
  }

  private reject(message: string, code: keyof typeof FinancialSplitErrors = 'SPLIT_ACCOUNT_LOCKED'): never {
    throw new VendixHttpException(FinancialSplitErrors[code], message);
  }

  private async lockedAccount(tx: any, orderId: number, accountId: number) {
    const { store_id } = this.context();
    const rows = await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${store_id} FOR UPDATE`;
    if (!rows.length) throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_FOUND);
    const order = await tx.orders.findFirst({ where: { id: orderId, store_id } });
    const account = await tx.order_financial_accounts.findFirst({
      where: { id: accountId, store_id, split_id: order.active_financial_split_id ?? -1, state: 'active' },
      include: { split: true, customer: { select: { id: true, first_name: true, last_name: true, legal_name: true, document_number: true } }, lines: { include: { taxes: true } } },
    });
    if (!account || account.split.source_order_id !== orderId || account.split.state !== 'active') {
      throw new VendixHttpException(FinancialSplitErrors.SPLIT_ACCOUNT_NOT_FOUND);
    }
    if (account.role !== 'payable') this.reject('Los abonos anteriores ya están pagados y no se vuelven a cobrar.');
    if (['cancelled', 'refunded'].includes(order.state)) this.reject('La orden ya no admite pagos.');
    return { order, account };
  }

  async pay(orderId: number, accountId: number, dto: SplitAccountPayDto) {
    const { store_id, user_id } = this.context();
    if (!user_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    let amount: Prisma.Decimal;
    try { amount = money(dto.amount); } catch { this.reject('Monto de pago inválido.', 'SPLIT_PAYMENT_AMOUNT'); }
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2) this.reject('Monto de pago inválido.', 'SPLIT_PAYMENT_AMOUNT');
    if (!dto.idempotency_key?.trim()) this.reject('La clave de idempotencia es obligatoria.');
    const key = `split:${store_id}:${createHash('sha256').update(dto.idempotency_key).digest('hex')}`;
    const requestHash = createHash('sha256').update(JSON.stringify({
      orderId, accountId, amount: amount.toFixed(2), method: dto.store_payment_method_id,
      bank: dto.bank_account_id ?? null, reference: dto.payment_reference ?? null,
      received: dto.amount_received ?? null, wompi: dto.wompi_payment_method ?? null,
      return_url: dto.return_url ?? null, cancel_url: dto.cancel_url ?? null,
    })).digest('hex');
    const registerSettings = (await this.settings.getSettings() as any)?.pos?.cash_register;
    const cashSession = registerSettings?.enabled ? await this.sessions.getActiveSession(user_id) : null;
    const reserved = await this.prisma.$transaction(async (tx: any) => {
      const { order, account } = await this.lockedAccount(tx, orderId, accountId);
      const existing = await tx.payments.findFirst({ where: { financial_idempotency_key: key }, include: { store_payment_method: { include: { system_payment_method: true } } } });
      if (existing) {
        if (existing.order_id !== orderId || existing.financial_account_id !== accountId ||
            existing.store_payment_method_id !== dto.store_payment_method_id || !money(existing.amount).eq(amount) ||
            (existing.bank_account_id ?? null) !== (dto.bank_account_id ?? null) ||
            existing.gateway_response?.financial_request?.request_hash !== requestHash) {
          this.reject('La clave de pago ya se usó con otra cuenta o importe.', 'SPLIT_IDEMPOTENCY_CONFLICT');
        }
        return { payment: existing, created: false, manual: existing.store_payment_method?.system_payment_method?.processing_mode === 'DIRECT' && MANUAL_METHODS.includes(existing.store_payment_method?.system_payment_method?.type) };
      }
      if (registerSettings?.enabled && registerSettings?.require_session_for_sales && !cashSession) {
        this.reject('Se requiere una caja registradora abierta para procesar ventas.');
      }
      if (cashSession) {
        const open = await tx.$queryRaw`SELECT id FROM cash_register_sessions WHERE id = ${cashSession.id} AND store_id = ${store_id} AND status = 'open' FOR UPDATE`;
        if (!open.length) this.reject('La sesión de caja cambió; vuelve a intentar el pago.');
      }
      const method = await tx.store_payment_methods.findFirst({
        where: { id: dto.store_payment_method_id, store_id, state: 'enabled' }, include: { system_payment_method: true },
      });
      if (!method?.system_payment_method?.is_active) this.reject('El medio de pago no está disponible.', 'SPLIT_PAYMENT_METHOD');
      const type = method.system_payment_method.type;
      const mode = method.system_payment_method.processing_mode;
      const manual = mode === 'DIRECT' && MANUAL_METHODS.includes(type);
      if (!manual && (mode !== 'ONLINE' || type !== 'wompi')) {
        this.reject('Las cuentas admiten efectivo, tarjeta o transferencia manual y pasarela Wompi; este medio no está integrado.', 'SPLIT_PAYMENT_METHOD');
      }
      if (!manual && !dto.wompi_payment_method) this.reject('Selecciona un método Wompi válido.', 'SPLIT_PAYMENT_METHOD');
      if (!manual && !account.customer_id) this.reject('Selecciona un cliente registrado para pagar por Wompi.', 'SPLIT_PAYMENT_METHOD');
      if (type === 'cash' && dto.amount_received != null && money(dto.amount_received).lt(amount)) {
        this.reject('El efectivo recibido es menor que el pago.', 'SPLIT_PAYMENT_AMOUNT');
      }
      if (dto.bank_account_id != null) {
        if (type !== 'bank_transfer') this.reject('La cuenta bancaria solo aplica a transferencia.', 'SPLIT_PAYMENT_METHOD');
        await this.gateway.resolveAndValidateBankAccount(dto.bank_account_id, store_id, tx);
      }
      const payments = await tx.payments.findMany({ where: { order_id: orderId, state: { in: BUDGETED } } });
      const total = (rows: any[]) => rows.reduce((sum, p) => sum.plus(money(p.amount)), money(0));
      const accountBudget = money(account.grand_total).minus(money(account.paid_snapshot))
        .minus(total(payments.filter((p: any) => p.financial_account_id === accountId)));
      const sourceBudget = money(order.grand_total).minus(total(payments));
      if (amount.gt(accountBudget) || amount.gt(sourceBudget)) this.reject('El monto excede el saldo disponible de la cuenta.', 'SPLIT_PAYMENT_AMOUNT');
      const payment = await tx.payments.create({
        data: {
          order_id: orderId, financial_account_id: accountId, financial_idempotency_key: key,
          customer_id: account.customer_id, amount, currency: order.currency,
          state: 'pending', store_payment_method_id: method.id,
          bank_account_id: dto.bank_account_id ?? null,
          transaction_id: `FIN-${randomUUID()}`,
          gateway_response: {
            financial_request: {
              created_by_user_id: user_id, authorized_store_id: store_id, request_hash: requestHash,
              cash_session_id: cashSession && (type === 'cash' || registerSettings?.track_non_cash_payments) ? cashSession.id : null,
              payment_reference: dto.payment_reference ?? null,
              amount_received: dto.amount_received ?? null,
              wompi_payment_method: dto.wompi_payment_method ?? null,
              return_url: dto.return_url ?? null, cancel_url: dto.cancel_url ?? null,
            },
          },
        },
      });
      return { payment, created: true, manual };
    });
    if (reserved.manual && reserved.payment.state === 'pending') {
      // This is staff acknowledgement of an off-platform collection, not an
      // invocation of Stripe for a terminal card or a bank API transfer.
      return this.confirm(orderId, accountId, reserved.payment.id, { payment_reference: dto.payment_reference });
    }
    if (!reserved.manual && reserved.payment.state === 'pending' && !reserved.payment.gateway_reference) {
      // Resume a crash before provider dispatch. A persisted reference means
      // outcome may be uncertain: only provider reconciliation can settle it.
      const dispatchKey = `financial-payment-dispatch:${store_id}:${reserved.payment.id}`;
      const owner = randomUUID();
      if (await this.redis.set(dispatchKey, owner, 'PX', 120_000, 'NX') === 'OK') {
        try {
          await this.gateway.processReservedPayment(reserved.payment.id);
        } finally {
          await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, dispatchKey, owner);
        }
      }
    }
    await this.reconcilePayment(reserved.payment.id);
    return this.response(orderId, reserved.payment.id);
  }

  async confirm(orderId: number, accountId: number, paymentId: number, dto: ConfirmSplitAccountPaymentDto) {
    const { store_id } = this.context();
    await this.prisma.$transaction(async (tx: any) => {
      await this.lockedAccount(tx, orderId, accountId);
      const payment = await tx.payments.findFirst({
        where: { id: paymentId, order_id: orderId, financial_account_id: accountId },
        include: { store_payment_method: { include: { system_payment_method: true } } },
      });
      if (!payment) throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_FOUND);
      const method = payment.store_payment_method;
      if (method?.store_id !== store_id || method.system_payment_method?.processing_mode !== 'DIRECT' ||
          !MANUAL_METHODS.includes(method.system_payment_method?.type)) {
        this.reject('Los pagos de pasarela solo se confirman mediante el proveedor.', 'SPLIT_PAYMENT_METHOD');
      }
      if (RECEIVED.includes(payment.state)) return;
      if (payment.state !== 'pending') this.reject('El pago ya terminó y no puede confirmarse.');
      await tx.payments.updateMany({
        where: { id: paymentId, state: 'pending' },
        data: { state: 'succeeded', paid_at: new Date(), updated_at: new Date(),
          gateway_reference: dto.payment_reference ?? null },
      });
    });
    await this.reconcilePayment(paymentId);
    return this.response(orderId, paymentId);
  }

  /** Also called by the financial-account webhook bridge after provider commit. */
  async reconcilePayment(paymentId: number): Promise<void> {
    const { store_id, organization_id } = this.context();
    const lockKey = `financial-payment-effects:${store_id}:${paymentId}`;
    const lockOwner = randomUUID();
    if (await this.redis.set(lockKey, lockOwner, 'PX', 120_000, 'NX') !== 'OK') return;
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { id: paymentId, financial_account_id: { not: null }, orders: { store_id } },
        include: { store_payment_method: { include: { system_payment_method: true } } },
      });
      if (!payment || !RECEIVED.includes(payment.state)) return;
      const method = payment.store_payment_method?.system_payment_method?.type ?? 'cash';
      const originalUser = (payment.gateway_response as any)?.financial_request?.created_by_user_id;
      if (!Number.isInteger(originalUser) || originalUser <= 0) this.reject('El pago no tiene operador; requiere conciliación.');
      // Attribution must remain the authenticated creator, never whoever
      // happens to retry reconciliation or the unauthenticated webhook actor.
      const actor = await this.prisma.users.findFirst({
        where: { id: originalUser, organization_id }, select: { id: true },
      });
      if (!actor || (payment.gateway_response as any)?.financial_request?.authorized_store_id !== store_id) {
        this.reject('El pago no conserva autorización del operador original para esta tienda.');
      }
      const cashSessionId = (payment.gateway_response as any)?.financial_request?.cash_session_id;
      const cashSession = cashSessionId ? await this.prisma.cash_register_sessions.findFirst({
        where: { id: cashSessionId, store_id }, select: { id: true },
      }) : null;
      if (cashSessionId && !cashSession) this.reject('No se encuentra la caja original del pago.');
      const result = await this.prisma.$transaction(async (tx: any) => {
        const { order, account } = await this.lockedAccount(tx, payment.order_id, payment.financial_account_id!);
        const payments = await tx.payments.findMany({ where: { order_id: order.id, state: { in: RECEIVED } } });
        const paid = payments.reduce((sum: Prisma.Decimal, p: any) => sum.plus(money(p.amount)), money(0));
        await tx.orders.updateMany({ where: { id: order.id, store_id }, data: {
          total_paid: paid, remaining_balance: Prisma.Decimal.max(0, money(order.grand_total).minus(paid)),
        } });
        if (cashSession) {
          const existing = await tx.cash_register_movements.findFirst({ where: { payment_id: paymentId, type: 'sale', store_id } });
          if (!existing) await tx.cash_register_movements.create({ data: {
            store_id, user_id: originalUser, session_id: cashSession.id, type: 'sale',
            amount: payment.amount, payment_method: method, order_id: order.id, payment_id: paymentId,
          } });
        }
        let paidSession: any = null;
        if (paid.gte(money(order.grand_total))) {
          const session = await tx.table_sessions.findFirst({ where: { order_id: order.id, store_id, closed_at: null, paid_at: null } });
          if (session) paidSession = await this.tableSessions.markSessionPaid(session.id, paymentId, tx);
        }
        const fresh = await tx.payments.findFirst({ where: { id: paymentId } });
        return { order, account, paidSession, recorded: !!fresh.financial_effects_recorded_at };
      });
      if (result.paidSession) {
        this.tableSessions.emitSessionPaid(store_id, result.paidSession.id, payment.order_id, paymentId);
      }
      if (result.recorded) return;
      // The financial accounting consumer loads this account's immutable
      // snapshot and allocates recognition under its own transaction/lock.
      // These are full account headers, NOT independently rounded payment shares.
      await this.events.emitAsync('payment.received', {
        payment_id: paymentId, financial_account_id: payment.financial_account_id,
        store_id, organization_id, order_id: payment.order_id, order_number: result.order.order_number,
        amount: Number(payment.amount), currency: payment.currency, payment_method: method, user_id: originalUser,
        subtotal_amount: Number(result.account.subtotal_amount), discount_amount: Number(result.account.discount_amount),
        tax_amount: Number(result.account.tax_amount), shipping_amount: Number(result.account.shipping_cost),
        tip_amount: Number(result.account.tip_amount),
        tax_breakdown: buildTaxBreakdown(result.account.lines.flatMap((line: any) => line.taxes)),
        ...(result.account.customer ? { customer: { id: result.account.customer.id,
          name: result.account.customer.legal_name || [result.account.customer.first_name, result.account.customer.last_name].filter(Boolean).join(' '),
          tax_id: result.account.customer.document_number ?? undefined,
        } } : {}),
      });
      // The row is the durable pending-effects marker. If emission fails, it
      // remains null and a retry reconciles the same payment, never recharges it.
      await (this.prisma as any).payments.updateMany({
        where: { id: paymentId, financial_effects_recorded_at: null },
        data: { financial_effects_recorded_at: new Date() },
      });
    } finally {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockOwner);
    }
  }

  async reconcileReceivedForOrder(orderId: number): Promise<void> {
    const { store_id } = this.context();
    const payments = await this.prisma.payments.findMany({
      where: { order_id: orderId, orders: { store_id }, financial_account_id: { not: null },
        state: { in: ['succeeded', 'captured'] }, financial_effects_recorded_at: null },
      orderBy: { id: 'asc' }, select: { id: true },
    });
    for (const payment of payments) await this.reconcilePayment(payment.id);
  }

  private async response(orderId: number, paymentId: number) {
    const payment = await this.prisma.payments.findFirst({
      where: { id: paymentId, order_id: orderId, orders: { store_id: this.context().store_id } },
      select: { id: true, amount: true, state: true, gateway_response: true },
    });
    const gatewayResponse = payment?.gateway_response as any;
    return {
      payment: { id: payment?.id, amount: String(payment?.amount), state: payment?.state,
        nextAction: gatewayResponse?.nextAction ?? null },
      split: await this.splitOrders.getSplit(orderId),
    };
  }
}
