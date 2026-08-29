import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { QueryUnassignedPaymentsDto } from './dto/query-unassigned-payments.dto';
import {
  AssignableBankAccount,
  UnassignedPayment,
} from './dto/unassigned-payment.dto';

/**
 * Servicio de "pagos sin asignar" (CP-POLLO-ARABE-727 / E.2 — cross-ref QUI-728).
 *
 * Cierra el ciclo contable: un `payments` con `bank_account_id` poblado entra
 * directo a la conciliación bancaria (qué cuenta propia recibió el cobro); los
 * pagos con `bank_account_id NULL` quedan en "Sin asignar" para revisión
 * manual, y aquí se listan y se les asigna la cuenta de destino.
 *
 * IMPORTANTE — cómo se relaciona con el matching existente:
 *  - `reconciliation-matching.service.ts` y `reconciliation.service.ts:113`
 *    emparejan `bank_transaction_id` (líneas de un extracto bancario importado)
 *    con `accounting_entry_id` (asientos contables). Ese matching opera sobre
 *    OTRO modelo de datos y NO se toca desde aquí.
 *  - `digital-payment-matcher.service.ts` es el puente afín: ya lee
 *    `this.prisma.payments.findMany` y resume pagos digitales sin emparejar
 *    contra `bank_transactions`. Este servicio hermana ese listado, pero para
 *    el caso concreto de `bank_account_id IS NULL`.
 *
 * Las operaciones son NO destructivas: solo lecturas y un `updateMany` con
 * `WHERE` acotado (guarda de carrera sobre `bank_account_id = null`).
 */
@Injectable()
export class UnassignedPaymentsService {
  private readonly logger = new Logger(UnassignedPaymentsService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Lista paginada de pagos sin asignar (bank_account_id IS NULL) de la tienda.
   * `StorePrismaService` auto-escopa `payments` por la relación `orders.store_id`.
   * Solo se listan pagos `succeeded`: un cobro no exitoso no entra al ciclo
   * contable y no tiene sentido asignarle una cuenta bancaria.
   */
  async findUnassigned(query: QueryUnassignedPaymentsDto): Promise<{
    data: UnassignedPayment[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit =
      query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 25;
    const skip = (page - 1) * limit;

    const where: Prisma.paymentsWhereInput = {
      bank_account_id: null,
      state: 'succeeded',
      ...(query.date_from && { paid_at: { gte: new Date(query.date_from) } }),
      ...(query.date_to && { paid_at: { lte: new Date(query.date_to) } }),
      ...(query.search && {
        OR: [
          {
            orders: {
              order_number: { contains: query.search, mode: 'insensitive' },
            },
          },
          {
            gateway_reference: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.payments.findMany({
        where,
        orderBy: { paid_at: 'desc' },
        skip,
        take: limit,
        include: {
          payment_methods: { select: { type: true, display_name: true } },
          orders: { select: { order_number: true, customer_alias: true } },
        },
      }),
      this.prisma.payments.count({ where }),
    ]);

    return {
      data: rows.map((p) => this.toProjection(p)),
      total,
      page,
      limit,
    };
  }

  /**
   * Cuentas bancarias activas de la organización para el selector de asignación.
   * Proyección mínima `{id, name, bank_name, account_number}` — sin saldo ni
   * datos de extracto. `bank_accounts` está org-scoped en `StorePrismaService`.
   */
  async findAssignableAccounts(): Promise<AssignableBankAccount[]> {
    return this.prisma.bank_accounts.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, bank_name: true, account_number: true },
    });
  }

  /**
   * Asigna `payments.bank_account_id` a un pago que aún lo tiene NULL.
   *
   * Validaciones:
   *  1. El pago existe y todavía no tiene cuenta asignada.
   *  2. La cuenta pertenece a la organización (org-scope de `StorePrismaService`)
   *     y su `store_id` es NULL (cuenta compartida del org) o igual al
   *     `store_id` del pago (obtenido vía `orders.store_id`).
   *  3. Guarda de carrera: `updateMany` con `bank_account_id: null` en el WHERE;
   *     si `count === 0`, otro proceso la asignó primero → 409.
   *
   * NO destructivo: solo lecturas + un UPDATE acotado por WHERE.
   */
  async assignAccount(
    payment_id: number,
    bank_account_id: number,
  ): Promise<UnassignedPayment> {
    const payment = await this.prisma.payments.findFirst({
      where: { id: payment_id },
      include: {
        payment_methods: { select: { type: true, display_name: true } },
        orders: { select: { store_id: true, order_number: true, customer_alias: true } },
      },
    });

    if (!payment) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Payment not found',
      );
    }

    if (payment.bank_account_id !== null) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Payment already has an assigned bank account',
      );
    }

    const account = await this.prisma.bank_accounts.findFirst({
      where: { id: bank_account_id },
    });

    if (!account) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_NOT_FOUND);
    }

    // Cuenta compartida (store_id NULL) o cuenta de la misma tienda del pago.
    if (
      account.store_id !== null &&
      account.store_id !== payment.orders.store_id
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'Bank account does not belong to this store',
      );
    }

    const updated = await this.prisma.payments.updateMany({
      where: { id: payment_id, bank_account_id: null },
      data: { bank_account_id },
    });

    if (updated.count === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Payment was already assigned to a bank account',
      );
    }

    this.logger.log(
      `Payment ${payment_id} assigned to bank account ${bank_account_id}`,
    );

    // La proyección no expone `bank_account_id`, así que el pago original ya
    // basta para responder; el frontend recarga la lista tras la asignación.
    return this.toProjection(payment);
  }

  private toProjection(payment: any): UnassignedPayment {
    return {
      payment_id: payment.id,
      order_id: payment.order_id,
      order_number: payment.orders?.order_number ?? null,
      amount: Number(payment.amount),
      currency: payment.currency ?? null,
      state: payment.state,
      paid_at: payment.paid_at ? payment.paid_at.toISOString() : null,
      payment_method: payment.payment_methods?.type ?? null,
      payment_method_display:
        payment.payment_methods?.display_name ?? null,
      gateway_reference: payment.gateway_reference ?? null,
      customer_alias: payment.orders?.customer_alias ?? null,
    };
  }
}
