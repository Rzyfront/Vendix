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
 * El reintento vive acá (`sweepStrandedRefundCashMovements`, cada 60 s)
 * y en la cola BullMQ `accounting-entry-retry`: su processor enruta
 * `REFUND_CASH_MOVEMENT_KEY` a `deliverRefundCashMovement` (release-853,
 * paso 6 — nunca a `postAutoEntry`, que postearía un asiento contable en
 * vez del movimiento de caja). Ambas vías comparten el lock de fila de
 * `deliverRefundCashMovement`, así que nunca entregan dos veces.
 */
export const REFUND_CASH_MOVEMENT_KEY = 'refund_cash_movement_v1';
export const REFUND_CASH_MOVEMENT_SOURCE = 'refund.cash_movement';

/**
 * Referencia del movimiento de compensación que registra la cancelación de una
 * orden cobrada (convención hermana de `'payment_cancelled'`, que usan las
 * anulaciones de pago). La consume el flujo de cancelación de órdenes.
 */
export const ORDER_CANCELLED_MOVEMENT_REFERENCE = 'order_cancelled';

/**
 * Marca de las filas del outbox encoladas con la entrega por registro (cualquier
 * sesión abierta del mismo registro). Las filas sin esta marca son anteriores
 * al cambio: su dinero salió de sesiones ya cerradas y NO se entregan a ninguna
 * caja automáticamente (revisión manual).
 */
export const CASH_MOVEMENT_DELIVERY_SCOPE = 'register_v2';

/** Prefijo de `error_message` de las filas legacy marcadas para revisión manual. */
export const LEGACY_MANUAL_REVIEW_PREFIX = 'LEGACY_MANUAL_REVIEW';
const LEGACY_MANUAL_REVIEW_MESSAGE =
  `${LEGACY_MANUAL_REVIEW_PREFIX}: reembolso en efectivo encolado antes del ` +
  `2026-10-03; no se entrega a ninguna caja automáticamente. Revisar a mano ` +
  `contra la sesión original.`;

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
  /**
   * Opcionales (movimientos de compensación que no son un refund: cancelación
   * de orden, anulación de pago). Los encolados viejos no los traen y se
   * entregan igual: reference = `refund:<refund_id>`, método = `channel`.
   */
  reference?: string;
  payment_method?: string;
  /** Clave de dedupe del outbox; su presencia marca el payload como compensación. */
  dedupe_key?: string;
  notes?: string;
  /** `CASH_MOVEMENT_DELIVERY_SCOPE` en filas nuevas; ausente en las legacy. */
  delivery_scope?: string;
}

/** `source_type` de las filas del outbox de compensaciones (≠ refund). */
export const COMPENSATION_CASH_MOVEMENT_SOURCE = 'cash.compensation_movement';

export interface CompensationSessionInput {
  store_id: number;
  user_id: number;
  payment_id?: number | null;
  order_id?: number | null;
}

export type NonCashRefundMovementOutcome =
  | { status: 'recorded'; movement_id: number }
  | { status: 'exists'; movement_id: number }
  | { status: 'skipped'; reason: 'no_open_cash_session' };

export type CompensationCashMovementOutcome =
  | { status: 'recorded'; movement_id: number }
  | { status: 'exists'; movement_id: number }
  | { status: 'pending'; failure_id: number | null; reason: string };

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
      notes?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = (tx ?? this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;
    return db.cash_register_movements.create({
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
        notes: data.notes,
      },
    });
  }

  /**
   * Resuelve a qué sesión de caja debe asentarse un movimiento de
   * compensación (reembolso, cancelación). Cascada:
   *  a) la sesión del movimiento `sale` original (por `payment_id`; si no hay
   *     o no aparece, por `order_id`) si sigue abierta;
   *  b) la sesión abierta del usuario operador;
   *  c) cualquier sesión abierta del MISMO `cash_register_id` que la sesión
   *     original;
   *  d) `null` — el llamador encola.
   */
  async resolveCompensationSessionId(
    input: CompensationSessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number | null> {
    const db = (tx ?? this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;

    let origin_session: { id: number; status: string; cash_register_id: number } | null =
      null;
    let sale: { session_id: number } | null = null;
    if (input.payment_id != null) {
      sale = await db.cash_register_movements.findFirst({
        where: {
          store_id: input.store_id,
          type: 'sale',
          payment_id: input.payment_id,
        },
        orderBy: { id: 'asc' },
        select: { session_id: true },
      });
    }
    if (!sale && input.order_id != null) {
      sale = await db.cash_register_movements.findFirst({
        where: {
          store_id: input.store_id,
          type: 'sale',
          order_id: input.order_id,
        },
        orderBy: { id: 'asc' },
        select: { session_id: true },
      });
    }
    if (sale) {
      origin_session = await db.cash_register_sessions.findFirst({
        where: { id: sale.session_id, store_id: input.store_id },
        select: { id: true, status: true, cash_register_id: true },
      });
      if (origin_session?.status === 'open') return origin_session.id;
    }

    const own = await db.cash_register_sessions.findFirst({
      where: {
        store_id: input.store_id,
        status: 'open',
        opened_by: input.user_id,
      },
      orderBy: { opened_at: 'desc' },
      select: { id: true },
    });
    if (own) return own.id;

    if (origin_session) {
      const sibling = await db.cash_register_sessions.findFirst({
        where: {
          store_id: input.store_id,
          status: 'open',
          cash_register_id: origin_session.cash_register_id,
        },
        orderBy: { opened_at: 'desc' },
        select: { id: true },
      });
      if (sibling) return sibling.id;
    }
    return null;
  }

  /**
   * Movimiento `refund` de un reembolso NO efectivo ya completado
   * (transferencia, pasarela, saldo interno). Deja rastro en el libro de caja
   * con el método real; `computeCashSummary` solo resta refunds `cash`, así que
   * no altera el esperado de efectivo. No emite `cash_register.movement`: el
   * asiento contable ya lo genera `refund.completed` (evitar doble asiento).
   * Idempotente por (store, refund, reference, payment_id, método). Sin sesión
   * destino NO se encola: devuelve `skipped` y el llamador loguea/audita.
   */
  async recordNonCashRefundMovement(input: {
    store_id: number;
    user_id: number;
    refund_id: number;
    order_id: number;
    payment_id: number | null;
    amount: number;
    payment_method: string;
  }): Promise<NonCashRefundMovementOutcome> {
    const db = this.prisma.withoutScope();
    const reference = buildRefundCashMovementReference(input.refund_id);
    const existing = await db.cash_register_movements.findFirst({
      where: {
        store_id: input.store_id,
        type: 'refund',
        reference,
        payment_id: input.payment_id,
        payment_method: input.payment_method,
      },
      select: { id: true },
    });
    if (existing) return { status: 'exists', movement_id: existing.id };

    const session_id = await this.resolveCompensationSessionId({
      store_id: input.store_id,
      user_id: input.user_id,
      payment_id: input.payment_id,
      order_id: input.order_id,
    });
    if (session_id == null) {
      this.logger.warn(
        `Refund #${input.refund_id} (order #${input.order_id}): non-cash ` +
          `(${input.payment_method}) refund movement NOT recorded — no open ` +
          `cash session to receive it.`,
      );
      return { status: 'skipped', reason: 'no_open_cash_session' };
    }
    const movement = await this.recordRefundMovement(session_id, {
      store_id: input.store_id,
      user_id: input.user_id,
      amount: input.amount,
      payment_method: input.payment_method,
      order_id: input.order_id,
      payment_id: input.payment_id ?? undefined,
      reference,
    });
    return { status: 'recorded', movement_id: movement.id };
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 4 — entrega durable del movimiento de caja
   * del refund. Nunca es silenciosa: devuelve `recorded` con el movimiento,
   * o `pending` con la fila del outbox que el operador ve en
   * `store/accounting/entry-failures` y que el sweeper reintenta.
   *
   * La sesión destino se resuelve aquí con `resolveCompensationSessionId`
   * (este servicio no puede inyectar `SessionsService`: ciclo). Sin sesión
   * destino → outbox directo.
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
    // Cascada de compensación: sesión de la venta original (si sigue abierta),
    // sesión del operador, otra sesión abierta del mismo registro. `null` =
    // nadie puede recibirlo ahora → outbox (el barrido usa la misma cascada).
    const session_id = await this.resolveCompensationSessionId({
      store_id: input.store_id,
      user_id: input.user_id,
      payment_id: input.payment_id,
      order_id: input.order_id,
    });
    if (session_id == null) {
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
      const movement = await this.recordRefundMovement(session_id, {
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
   * Movimiento `refund` de compensación que NO nace de un refund (cancelación
   * de orden cobrada, anulación de pago). Nunca es silencioso ni se pierde:
   *  1. idempotente por (reference, payment_id, order_id, método);
   *  2. sesión destino por `resolveCompensationSessionId` (original abierta →
   *     operador → mismo registro);
   *  3. sin sesión (o si el insert falla) → outbox durable con dedupe por
   *     `dedupe_key`; el sweeper/cola lo entrega con la misma cascada.
   * NO emite `cash_register.movement`: el asiento contable de la salida lo
   * genera el evento de negocio (`refund.completed`, `payment.voided`...).
   */
  async recordCompensationCashMovementDurable(
    input: {
      store_id: number;
      user_id: number;
      order_id: number;
      payment_id: number | null;
      amount: number;
      reference: string;
      dedupe_key: string;
      notes?: string;
      payment_method?: string;
      organization_id?: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CompensationCashMovementOutcome> {
    const db = (tx ?? this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;
    const payment_method = input.payment_method ?? 'cash';

    const existing = await db.cash_register_movements.findFirst({
      where: {
        store_id: input.store_id,
        type: 'refund',
        reference: input.reference,
        payment_id: input.payment_id,
        order_id: input.order_id,
        payment_method,
      },
      select: { id: true },
    });
    if (existing) return { status: 'exists', movement_id: existing.id };

    let organization_id = input.organization_id;
    if (organization_id == null) {
      const store = await db.stores.findUnique({
        where: { id: input.store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }
    if (organization_id == null) {
      throw new Error(
        `Compensation ${input.dedupe_key}: store #${input.store_id} not found`,
      );
    }
    const payload: RefundCashMovementPayload = {
      version: 1,
      refund_id: 0,
      order_id: input.order_id,
      store_id: input.store_id,
      organization_id,
      user_id: input.user_id,
      payment_id: input.payment_id,
      amount: input.amount,
      channel: payment_method,
      payment_method,
      reference: input.reference,
      dedupe_key: input.dedupe_key,
      notes: input.notes,
    };

    const session_id = await this.resolveCompensationSessionId(
      {
        store_id: input.store_id,
        user_id: input.user_id,
        payment_id: input.payment_id,
        order_id: input.order_id,
      },
      tx,
    );
    if (session_id == null) {
      const failure_id = await this.enqueueCompensationCashMovement(
        payload,
        'PENDING_DELIVERY: no open cash session for compensation cash movement',
      );
      this.logger.error(
        `Compensation ${input.dedupe_key} (order #${input.order_id}): cash ` +
          `movement NOT recorded — no open session. Outbox row #${failure_id}. ` +
          `Open a session; the sweeper will deliver it.`,
      );
      return { status: 'pending', failure_id, reason: 'no_open_cash_session' };
    }
    try {
      const movement = await this.recordRefundMovement(
        session_id,
        {
          store_id: input.store_id,
          user_id: input.user_id,
          amount: input.amount,
          payment_method,
          order_id: input.order_id,
          payment_id: input.payment_id ?? undefined,
          reference: input.reference,
          notes: input.notes,
        },
        tx,
      );
      return { status: 'recorded', movement_id: movement.id };
    } catch (error) {
      const failure_id = await this.enqueueCompensationCashMovement(
        payload,
        `PENDING_DELIVERY: cash movement insert failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.error(
        `Compensation ${input.dedupe_key} (order #${input.order_id}): cash ` +
          `movement insert failed, outbox row #${failure_id}. ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 'pending', failure_id, reason: 'movement_insert_failed' };
    }
  }

  /** Outbox de compensaciones: una fila abierta como máximo por `dedupe_key`. */
  private async enqueueCompensationCashMovement(
    payload: RefundCashMovementPayload,
    message: string,
  ): Promise<number> {
    const db = this.prisma.withoutScope();
    const existing = await db.accounting_entry_failures.findFirst({
      where: {
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_type: COMPENSATION_CASH_MOVEMENT_SOURCE,
        resolved_at: null,
        event_payload: { path: ['dedupe_key'], equals: payload.dedupe_key },
      },
      select: { id: true, event_payload: true },
    });
    if (existing) {
      await db.accounting_entry_failures.update({
        where: { id: existing.id },
        data: {
          attempt_count: { increment: 1 },
          error_message: message,
          event_payload: withDeliveryScope(
            payload,
            hasDeliveryScope(existing.event_payload),
          ),
        },
      });
      return existing.id;
    }
    const row = await db.accounting_entry_failures.create({
      data: {
        organization_id: payload.organization_id,
        store_id: payload.store_id,
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_type: COMPENSATION_CASH_MOVEMENT_SOURCE,
        source_id: payload.payment_id ?? payload.order_id,
        event_payload: withDeliveryScope(payload, true),
        error_message: message,
      },
    });
    return row.id;
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
      select: { id: true, event_payload: true },
    });
    if (existing) {
      await db.accounting_entry_failures.update({
        where: { id: existing.id },
        data: {
          attempt_count: { increment: 1 },
          error_message: message,
          event_payload: withDeliveryScope(
            payload,
            hasDeliveryScope(existing.event_payload),
          ),
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
        event_payload: withDeliveryScope(payload, true),
        error_message: message,
      },
    });
    return row.id;
  }

  /**
   * Entrega una fila del outbox: crea el movimiento contra la sesión que
   * resuelve `resolveCompensationSessionId`. Idempotente por `reference = refund:<id>`:
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
          (typeof payload.dedupe_key !== 'string' &&
            payload.refund_id !== row.source_id) ||
          payload.organization_id !== row.organization_id ||
          payload.store_id !== row.store_id ||
          typeof payload.amount !== 'number' ||
          !Number.isFinite(payload.amount)
        ) {
          throw new Error(`Invalid refund cash movement delivery #${failureId}`);
        }
        const is_compensation = typeof payload.dedupe_key === 'string';
        const reference =
          payload.reference ?? buildRefundCashMovementReference(payload.refund_id);
        const payment_method = payload.payment_method ?? payload.channel;
        const already = await tx.cash_register_movements.findFirst({
          where: {
            store_id: payload.store_id,
            type: 'refund',
            reference,
            payment_method,
            ...(is_compensation
              ? { payment_id: payload.payment_id, order_id: payload.order_id }
              : {}),
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
        // Fila anterior al cambio de entrega por registro: no entra a ninguna
        // caja. Se marca una sola vez y queda sin resolver para revisión manual.
        if (payload.delivery_scope !== CASH_MOVEMENT_DELIVERY_SCOPE) {
          if (!row.error_message?.startsWith(LEGACY_MANUAL_REVIEW_PREFIX)) {
            await tx.accounting_entry_failures.update({
              where: { id: failureId },
              data: {
                attempt_count: { increment: 1 },
                error_message: LEGACY_MANUAL_REVIEW_MESSAGE,
              },
            });
            this.logger.warn(
              `Outbox row #${failureId} (refund #${payload.refund_id}, order #${payload.order_id}) is legacy: marked for manual review, not delivered to any cash session.`,
            );
          }
          return;
        }
        // Cascada de compensación (compartida con el camino directo): sesión
        // de la venta original si sigue abierta, sesión del operador, o
        // cualquier sesión abierta del mismo registro que la original — así
        // un reembolso encolado no queda varado cuando otro cajero tiene la
        // caja. Si nadie puede recibirlo, la fila sigue pendiente.
        const session_id = await this.resolveCompensationSessionId(
          {
            store_id: payload.store_id,
            user_id: payload.user_id,
            payment_id: payload.payment_id,
            order_id: payload.order_id,
          },
          tx,
        );
        if (session_id == null) {
          throw new Error(
            `NO_OPEN_SESSION: no open cash session owned by user #${payload.user_id} in store #${payload.store_id} for refund #${payload.refund_id} (nor in the original sale's register)`,
          );
        }
        const session = { id: session_id };
        const movement = await tx.cash_register_movements.create({
          data: {
            session_id: session.id,
            store_id: payload.store_id,
            user_id: payload.user_id,
            type: 'refund',
            amount: payload.amount,
            payment_method,
            order_id: payload.order_id,
            payment_id: payload.payment_id,
            reference,
            notes: payload.notes,
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
          NOT: { error_message: { startsWith: LEGACY_MANUAL_REVIEW_PREFIX } },
        },
        select: { id: true },
        take: 50,
        orderBy: { created_at: 'asc' },
      });
    for (const row of rows) {
      try {
        await this.deliverRefundCashMovement(row.id);
      } catch (error) {
        this.logger.warn(
          `Refund cash movement delivery #${row.id} still pending: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function hasDeliveryScope(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { delivery_scope?: unknown }).delivery_scope ===
      CASH_MOVEMENT_DELIVERY_SCOPE
  );
}

/** Payload a persistir: con la marca de entrega solo si corresponde. */
function withDeliveryScope(
  payload: RefundCashMovementPayload,
  mark: boolean,
): Prisma.InputJsonValue {
  const { delivery_scope: _drop, ...rest } = payload;
  return (
    mark ? { ...rest, delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE } : rest
  ) as unknown as Prisma.InputJsonValue;
}
