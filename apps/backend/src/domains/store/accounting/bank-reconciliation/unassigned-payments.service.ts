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
 * `payments` NO tiene relación `payment_methods`: el método se alcanza vía
 * `store_payment_method` → `system_payment_method` (schema.prisma, modelo
 * `payments`). Escribir el nombre equivocado no rompe el build —Prisma lo
 * rechaza en runtime con un `PrismaClientValidationError` que sale como 500—,
 * así que el include vive aquí una sola vez y lo comparten las dos consultas.
 */
/**
 * Métodos que por naturaleza NO llegan a una cuenta bancaria: el dinero queda
 * en caja. Listarlos como "sin asignar" no le da al contador nada que asignar
 * —el contador solo crecería— así que se excluyen del listado. Valores del
 * `payment_methods_type_enum`; si mañana entra otro método de caja, va aquí.
 */
const METHODS_WITHOUT_BANK_ACCOUNT = ['cash', 'cash_on_delivery'] as const;

const PAYMENT_METHOD_INCLUDE = {
  select: {
    display_name: true,
    system_payment_method: {
      select: { name: true, display_name: true, type: true },
    },
  },
} as const;

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
    total_amount: number;
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
      AND: [
        // Un pago en efectivo NO tiene cuenta bancaria de destino por
        // naturaleza: nunca saldrá de "sin asignar" y el contador crecería para
        // siempre. En la tienda de prueba eran 267 de 347 filas, con solo 6
        // transferencias reales debajo. Los pagos SIN método (`store_payment_
        // method_id` NULL, históricos anteriores al catálogo) sí se listan: no
        // hay forma de saber si fueron transferencia, y el contador debe poder
        // vaciarse a mano.
        {
          OR: [
            { store_payment_method_id: null },
            {
              store_payment_method: {
                system_payment_method: {
                  type: { notIn: [...METHODS_WITHOUT_BANK_ACCOUNT] },
                },
              },
            },
          ],
        },
        ...(query.search
          ? [
              {
                OR: [
                  {
                    orders: {
                      order_number: {
                        contains: query.search,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                  },
                  {
                    gateway_reference: {
                      contains: query.search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const [rows, total, sum] = await Promise.all([
      this.prisma.payments.findMany({
        where,
        // `paid_at` es nullable y Postgres pone los NULL PRIMERO en DESC: sin
        // `nulls: 'last'` la primera página se llenaba de filas sin fecha.
        // `created_at` desempata y siempre existe.
        orderBy: [
          { paid_at: { sort: 'desc', nulls: 'last' } },
          { created_at: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          store_payment_method: PAYMENT_METHOD_INCLUDE,
          orders: { select: { order_number: true, customer_alias: true } },
        },
      }),
      this.prisma.payments.count({ where }),
      // El monto total es del CONJUNTO filtrado, no de la página: sumarlo en el
      // cliente sobre `rows` daba el total de 25 filas de 80 y el contador de
      // la tarjeta contradecía al de la lista que tenía al lado.
      this.prisma.payments.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      data: rows.map((p) => this.toProjection(p)),
      total,
      page,
      limit,
      total_amount: Number(sum._sum.amount ?? 0),
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
  ): Promise<{ payment: UnassignedPayment; total_amount: number }> {
    const payment = await this.prisma.payments.findFirst({
      where: { id: payment_id },
      include: {
        store_payment_method: PAYMENT_METHOD_INCLUDE,
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

    /**
     * Guarda de dominio (QUI-728+): un pago en efectivo / contra entrega NO
     * tiene cuenta bancaria de destino por naturaleza — el listado de "sin
     * asignar" ya los excluye vía el predicado de `findUnassigned`, pero
     * `assignAccount` se puede invocar directamente desde la API (PATCH
     * abierto). Si lo dejamos pasar, la conciliación bancaria recibe pagos
     * cuyo dinero jamás tocó una cuenta propia: el contador crecería sin
     * contrapartida real. Se compara contra la MISMA constante que el listado
     * para que las dos puertas digan lo mismo.
     */
    const methodType = payment.store_payment_method?.system_payment_method?.type;
    if (
      methodType &&
      (METHODS_WITHOUT_BANK_ACCOUNT as readonly string[]).includes(methodType)
    ) {
      throw new VendixHttpException(
        ErrorCodes.BANK_RECONCILIATION_CASH_METHOD_REJECTED,
        `Este pago se hizo en ${methodType === 'cash' ? 'efectivo' : 'contra entrega'}: no se le puede asignar una cuenta bancaria porque el dinero no pasó por una cuenta propia.`,
        { payment_id, method_type: methodType },
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

    // Después del `updateMany` re-leemos el agregado del CONJUNTO sin asignar
    // GLOBAL (sin filtros de fecha/búsqueda del listado, porque este endpoint
    // no los recibe). Esto le da al frontend el monto restante sin tener que
    // pegarle de nuevo a `findUnassigned` solo para refrescar la tarjeta "Monto
    // Total". El pago recién asignado queda excluido porque su `bank_account_id`
    // ya no es NULL y sale del `where`.
    const sum = await this.prisma.payments.aggregate({
      where: { bank_account_id: null, state: 'succeeded' },
      _sum: { amount: true },
    });

    return {
      payment: this.toProjection(payment),
      total_amount: Number(sum._sum.amount ?? 0),
    };
  }

  private toProjection(payment: any): UnassignedPayment {
    const storeMethod = payment.store_payment_method;
    const systemMethod = storeMethod?.system_payment_method;

    return {
      payment_id: payment.id,
      order_id: payment.order_id,
      order_number: payment.orders?.order_number ?? null,
      amount: Number(payment.amount),
      currency: payment.currency ?? null,
      state: payment.state,
      // `paid_at` solo se puebla en los caminos que pasan por el gateway: de
      // los 6 pagos por transferencia sin asignar de la tienda de prueba, uno.
      // Sin este respaldo la columna FECHA sale vacía en toda la pantalla, y
      // una fila sin fecha no se puede conciliar contra un extracto.
      paid_at: (payment.paid_at ?? payment.created_at)?.toISOString() ?? null,
      // Clave técnica del método (`bank_transfer`, `cash`…), no la etiqueta.
      payment_method: systemMethod?.name ?? null,
      // Misma cadena de fallback que el detalle de orden (B.5 / FB-08): un pago
      // huérfano —sin `store_payment_method_id` o con el método ya borrado—
      // debe pintar `—` en la UI, nunca `undefined`.
      payment_method_display:
        storeMethod?.display_name ??
        systemMethod?.display_name ??
        systemMethod?.name ??
        null,
      gateway_reference: payment.gateway_reference ?? null,
      customer_alias: payment.orders?.customer_alias ?? null,
    };
  }
}
