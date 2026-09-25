import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Interval } from '@nestjs/schedule';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 4 — outbox semántico para el movimiento de
 * caja del refund, sobre la tabla existente `accounting_entry_failures`
 * (mismo patrón que `ManualRefundDeliveryService`).
 *
 * Por qué esta tabla y no una nueva: es el único outbox versionado que ya
 * existe, la bandeja `store/accounting/entry-failures` le da al operador la
 * alerta visible que el paso exige, y no requiere migración (prohibida en
 * este paso). `source_id` es el `refund_id`: un SELECT por refund muestra
 * si su movimiento de caja quedó pendiente.
 *
 * El reintento NO va por la cola BullMQ `accounting-entry-retry`: su
 * processor solo sabe enrutar `manual_refund_delivery_v1` o re-postear
 * asientos vía `postAutoEntry`, y tocarlo está fuera del scope del paso.
 * El reintento vive acá (`sweepStrandedRefundCashMovements`, cada 60 s).
 */
export const REFUND_CASH_MOVEMENT_KEY = 'refund_cash_movement_v1';
export const REFUND_CASH_MOVEMENT_SOURCE = 'refund.cash_movement';

export interface RefundCashMovementPayload {
  version: 1;
  refund_id: number;
  order_id: number;
  store_id: number;
  organization_id: number;
  user_id: number;
  payment_id: number | null;
  amount: number;
  /** Canal efectivo real (`cash`), no un literal hardcodeado. */
  channel: string;
}

export type RefundCashMovementOutcome =
  | { status: 'recorded'; movement_id: number }
  | { status: 'pending'; failure_id: number | null; reason: string };

/** Referencia determinista del movimiento: hace idempotente la entrega. */
export function buildRefundCashMovementReference(refundId: number): string {
  return `refund:${refundId}`;
}

@Injectable()
export class MovementsService {
  private readonly logger = new Logger(MovementsService.name);
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  async findBySession(session_id: number) {
    return this.prisma.cash_register_movements.findMany({
      where: { session_id },
      include: {
        user: { select: { id: true, first_name: true, last_name: true } },
        order: { select: { id: true, order_number: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Movimiento manual de caja (`cash_in` / `cash_out`).
   *
   * `amount` acepta `Prisma.Decimal` además de `number` porque hay llamadores
   * que ya traen el monto en Decimal desde la base — p. ej. el egreso que
   * `OrderFlowService.cancelOrder` registra al cancelar una venta cobrada en
   * efectivo, cuya suma sale de `payments.amount` (`Decimal(12,2)`). Obligarlos
   * a pasar por `number` metería un salto por punto flotante entre la fila y la
   * columna, justo en el dato que después tiene que cuadrar contra el arqueo.
   * La columna es `Decimal(12,2)` y Prisma acepta ambos tipos; el `Number(...)`
   * del evento contable también (decimal.js define `valueOf`).
   */
  async createManualMovement(
    session_id: number,
    data: {
      type: 'cash_in' | 'cash_out';
      amount: number | Prisma.Decimal;
      reference?: string;
      notes?: string;
    },
  ) {
    const context = RequestContextService.getContext()!;

    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id },
    });
    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }
    if (session.status !== 'open') {
      throw new BadRequestException('La sesión de caja ya no está abierta');
    }

    const movement = await this.prisma.cash_register_movements.create({
      data: {
        session_id,
        store_id: context.store_id,
        user_id: context.user_id,
        type: data.type,
        amount: data.amount,
        payment_method: 'cash',
        reference: data.reference,
        notes: data.notes,
      },
    });

    // Emit accounting event for manual cash movement
    const store = await this.prisma.stores.findUnique({
      where: { id: movement.store_id },
      select: { organization_id: true },
    });
    if (store) {
      this.event_emitter.emit('cash_register.movement', {
        movement_id: movement.id,
        session_id: session_id,
        store_id: movement.store_id,
        organization_id: store.organization_id,
        type: data.type,
        amount: Number(data.amount),
        reference: data.reference,
        notes: data.notes,
        user_id: movement.user_id,
      });
    }

    return movement;
  }

  /**
   * Record a sale movement from POS payment processing.
   * Called automatically when cash_register feature is enabled.
   */
  async recordSaleMovement(
    session_id: number,
    data: {
      store_id: number;
      user_id: number;
      amount: number;
      payment_method: string;
      order_id: number;
      payment_id?: number;
    },
  ) {
    return this.prisma.withoutScope().cash_register_movements.create({
      data: {
        session_id,
        store_id: data.store_id,
        user_id: data.user_id,
        type: 'sale',
        amount: data.amount,
        payment_method: data.payment_method,
        order_id: data.order_id,
        payment_id: data.payment_id ?? null,
      },
    });
  }

  /**
   * Record a refund movement from refund processing.
   */
  async recordRefundMovement(
    session_id: number,
    data: {
      store_id: number;
      user_id: number;
      amount: number;
      payment_method: string;
      order_id?: number;
      payment_id?: number;
      reference?: string;
    },
  ) {
    return this.prisma.withoutScope().cash_register_movements.create({
      data: {
        session_id,
        store_id: data.store_id,
        user_id: data.user_id,
        type: 'refund',
        amount: data.amount,
        payment_method: data.payment_method,
        order_id: data.order_id,
        payment_id: data.payment_id,
        reference: data.reference,
      },
    });
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 4 — entrega durable del movimiento de caja
   * del refund. Nunca es silenciosa: devuelve `recorded` con el movimiento,
   * o `pending` con la fila del outbox que el operador ve en
   * `store/accounting/entry-failures` y que el sweeper reintenta.
   *
   * `session_id` lo resuelve el llamador (`SessionsService.getActiveSession`
   * tal cual): este servicio no puede inyectar `SessionsService` porque ya
   * lo consume (ciclo). `null` = sin sesión abierta → outbox directo.
   */
  async recordRefundCashMovementDurable(input: {
    organization_id: number;
    store_id: number;
    user_id: number;
    refund_id: number;
    order_id: number;
    payment_id: number | null;
    amount: number;
    channel: string;
    session_id: number | null;
  }): Promise<RefundCashMovementOutcome> {
    const payload: RefundCashMovementPayload = {
      version: 1,
      refund_id: input.refund_id,
      order_id: input.order_id,
      store_id: input.store_id,
      organization_id: input.organization_id,
      user_id: input.user_id,
      payment_id: input.payment_id,
      amount: input.amount,
      channel: input.channel,
    };
    if (input.session_id == null) {
      const failure_id = await this.enqueueRefundCashMovement(
        payload,
        'PENDING_DELIVERY: no open cash session for refund cash movement',
      );
      this.logger.error(
        `Refund #${input.refund_id} (order #${input.order_id}): cash movement ` +
          `NOT recorded — no open session. Outbox row #${failure_id}. ` +
          `Open a session; the sweeper will deliver it.`,
      );
      return {
        status: 'pending',
        failure_id,
        reason: 'no_open_cash_session',
      };
    }
    try {
      const movement = await this.recordRefundMovement(input.session_id, {
        store_id: input.store_id,
        user_id: input.user_id,
        amount: input.amount,
        payment_method: input.channel,
        order_id: input.order_id,
        payment_id: input.payment_id ?? undefined,
        reference: buildRefundCashMovementReference(input.refund_id),
      });
      return { status: 'recorded', movement_id: movement.id };
    } catch (error) {
      const failure_id = await this.enqueueRefundCashMovement(
        payload,
        `PENDING_DELIVERY: cash movement insert failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.error(
        `Refund #${input.refund_id} (order #${input.order_id}): cash movement ` +
          `insert failed, outbox row #${failure_id}. ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: 'pending',
        failure_id,
        reason: 'movement_insert_failed',
      };
    }
  }

  /**
   * Crea (o reutiliza, por dedup) la fila del outbox para el movimiento de
   * caja de un refund. Dedup por `(handler_key, source_type, source_id
   * unresolved)` — el mismo predicado que `recordFailure`: un refund tiene
   * UNA fila abierta como máximo.
   */
  private async enqueueRefundCashMovement(
    payload: RefundCashMovementPayload,
    message: string,
  ): Promise<number> {
    const db = this.prisma.withoutScope();
    const existing = await db.accounting_entry_failures.findFirst({
      where: {
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_type: REFUND_CASH_MOVEMENT_SOURCE,
        source_id: payload.refund_id,
        resolved_at: null,
      },
      select: { id: true },
    });
    if (existing) {
      await db.accounting_entry_failures.update({
        where: { id: existing.id },
        data: {
          attempt_count: { increment: 1 },
          error_message: message,
          event_payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      return existing.id;
    }
    const row = await db.accounting_entry_failures.create({
      data: {
        organization_id: payload.organization_id,
        store_id: payload.store_id,
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_type: REFUND_CASH_MOVEMENT_SOURCE,
        source_id: payload.refund_id,
        event_payload: payload as unknown as Prisma.InputJsonValue,
        error_message: message,
      },
    });
    return row.id;
  }

  /**
   * Entrega una fila del outbox: crea el movimiento contra la sesión abierta
   * más reciente de la tienda. Idempotente por `reference = refund:<id>`:
   * si el movimiento ya existe (entrega previa que resolvió tarde), solo
   * marca la fila como resuelta. Sin sesión abierta lanza — el llamador
   * registra el intento y la fila sigue abierta para el próximo barrido.
   */
  async deliverRefundCashMovement(failureId: number): Promise<void> {
    try {
      await this.prisma.withoutScope().$transaction(async (tx) => {
        // Mismo lock de fila que `ManualRefundDeliveryService.deliver`: el
        // sweeper y un reintento manual nunca entregan dos veces.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM accounting_entry_failures WHERE id = ${failureId} FOR UPDATE`;
        if (locked.length !== 1) return;
        const row = await tx.accounting_entry_failures.findFirst({
          where: { id: failureId, handler_key: REFUND_CASH_MOVEMENT_KEY },
        });
        if (!row || row.resolved_at) return;
        const payload = row.event_payload as unknown as RefundCashMovementPayload;
        if (
          payload.version !== 1 ||
          payload.refund_id !== row.source_id ||
          payload.organization_id !== row.organization_id ||
          payload.store_id !== row.store_id ||
          typeof payload.amount !== 'number' ||
          !Number.isFinite(payload.amount)
        ) {
          throw new Error(`Invalid refund cash movement delivery #${failureId}`);
        }
        const reference = buildRefundCashMovementReference(payload.refund_id);
        const already = await tx.cash_register_movements.findFirst({
          where: {
            store_id: payload.store_id,
            type: 'refund',
            reference,
          },
          select: { id: true },
        });
        if (already) {
          await tx.accounting_entry_failures.update({
            where: { id: failureId },
            data: {
              resolved_at: new Date(),
              error_message: `DELIVERED_EXISTS: movement #${already.id} already recorded for refund #${payload.refund_id}`,
            },
          });
          return;
        }
        const session = await tx.cash_register_sessions.findFirst({
          where: { store_id: payload.store_id, status: 'open' },
          orderBy: { opened_at: 'desc' },
          select: { id: true },
        });
        if (!session) {
          throw new Error(
            `NO_OPEN_SESSION: no open cash session in store #${payload.store_id} for refund #${payload.refund_id}`,
          );
        }
        const movement = await tx.cash_register_movements.create({
          data: {
            session_id: session.id,
            store_id: payload.store_id,
            user_id: payload.user_id,
            type: 'refund',
            amount: payload.amount,
            payment_method: payload.channel,
            order_id: payload.order_id,
            payment_id: payload.payment_id,
            reference,
          },
        });
        await tx.accounting_entry_failures.update({
          where: { id: failureId },
          data: {
            resolved_at: new Date(),
            error_message: `DELIVERED: movement #${movement.id} recorded in session #${session.id}`,
          },
        });
      });
    } catch (error) {
      await this.prisma.withoutScope().accounting_entry_failures.update({
        where: { id: failureId },
        data: {
          attempt_count: { increment: 1 },
          error_message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  /**
   * Reintento de las filas del outbox que quedaron varadas (sin sesión
   * abierta al momento del refund). Solo toca filas quietas ≥ 5 min para no
   * spamear el log cada minuto cuando una tienda nunca abre caja; sin tope
   * de intentos — una fila sin sesión puede tardar días en ser entregable.
   */
  @Interval(60_000)
  async sweepStrandedRefundCashMovements(): Promise<void> {
    const quietSince = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await this.prisma
      .withoutScope()
      .accounting_entry_failures.findMany({
        where: {
          handler_key: REFUND_CASH_MOVEMENT_KEY,
          resolved_at: null,
          updated_at: { lte: quietSince },
        },
        select: { id: true },
        take: 50,
        orderBy: { created_at: 'asc' },
      });
    for (const row of rows) {
      try {
        await this.deliverRefundCashMovement(row.id);
      } catch (error) {
        this.logger.error(
          `Refund cash movement delivery #${row.id} still pending: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
