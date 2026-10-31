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
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { MAX_MANUAL_MOVEMENT_AMOUNT } from '../dto/create-movement.dto';

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
/** B18: outbox refund row with no actor to book it to. */
export const REFUND_NO_ACTOR_PREFIX = 'PENDING_REVIEW_NO_ACTOR';
export const DEFERRED_SALE_CASH_MOVEMENT_KEY = 'deferred_sale_cash_movement_v1';
export const DEFERRED_SALE_CASH_MOVEMENT_SOURCE = 'order.deferred_cash_movement';

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
  /** `null` (B18): nobody to book it to; the row stays queued for review. */
  user_id: number | null;
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
  /** Compensación B02: la entrega usa la sesión del `sale` (ver `CompensationSessionInput`). */
  sale_session_first?: boolean;
}

export interface DeferredSaleCashMovementInput {
  failure_id: number;
  session_id: number;
  store_id: number;
  order_id: number;
  user_id: number;
  payment_ids: number[];
  ready_state: 'finished' | 'delivered';
  compensation_state: string;
}

/** `source_type` de las filas del outbox de compensaciones (≠ refund). */
export const COMPENSATION_CASH_MOVEMENT_SOURCE = 'cash.compensation_movement';

export interface CompensationSessionInput {
  store_id: number;
  user_id: number;
  payment_id?: number | null;
  order_id?: number | null;
  /**
   * Compensación automática de un fallo dentro del MISMO cobro (B02): el
   * contra-movimiento va a la sesión del `sale` compensado (mismo cajón, mismo
   * instante), no a la del operador. Sin este flag manda el cajón del operador.
   */
  sale_session_first?: boolean;
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

  private async assertOpenSessionLocked(
    db: Prisma.TransactionClient,
    session_id: number,
    store_id: number,
  ): Promise<void> {
    const locked = await db.$queryRaw<{ id: number }[]>`
      SELECT id FROM cash_register_sessions
      WHERE id = ${session_id} AND store_id = ${store_id} AND status = 'open'
      FOR UPDATE
    `;
    if (locked.length === 1) return;

    const session = await db.cash_register_sessions.findFirst({
      where: { id: session_id, store_id },
      select: { id: true, status: true },
    });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    throw new BadRequestException('La sesión de caja ya no está abierta');
  }

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
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const amount_number = Number(data.amount);
    if (
      !Number.isFinite(amount_number) ||
      amount_number <= 0 ||
      amount_number > MAX_MANUAL_MOVEMENT_AMOUNT ||
      Math.round(amount_number * 100) / 100 !== amount_number
    ) {
      throw new VendixHttpException(ErrorCodes.CASH_MOVEMENT_AMOUNT_INVALID_001);
    }
    if (data.type === 'cash_out' && !data.notes?.trim()) {
      throw new VendixHttpException(ErrorCodes.CASH_MOVEMENT_NOTES_REQUIRED_001);
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      await this.assertOpenSessionLocked(tx, session_id, store_id);
      // B13: la sesión debe ser del usuario. Solo dueño/admin operan cajas
      // ajenas: `close_session` lo tienen cajero, empleado y repartidor, así
      // que no sirve de compuerta (no existe `close_any`).
      const session = await tx.cash_register_sessions.findFirst({
        where: { id: session_id, store_id },
        select: { opened_by: true },
      });
      const roles = context.roles ?? [];
      const can_use_foreign =
        context.is_owner ||
        context.is_super_admin ||
        roles.includes('owner') ||
        roles.includes('admin');
      if (session?.opened_by !== context.user_id && !can_use_foreign) {
        throw new VendixHttpException(
          ErrorCodes.CASH_MOVEMENT_FOREIGN_SESSION_001,
        );
      }
      return tx.cash_register_movements.create({
        data: {
          session_id,
          store_id,
          user_id: context.user_id,
          type: data.type,
          amount: data.amount,
          payment_method: 'cash',
          reference: data.reference,
          notes: data.notes,
        },
      });
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
    tx?: Prisma.TransactionClient,
  ) {
    const create = async (db: Prisma.TransactionClient) => {
      await this.assertOpenSessionLocked(db, session_id, data.store_id);
      return db.cash_register_movements.create({
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
    };
    if (tx) return create(tx);
    return this.prisma.$transaction((db) => create(db));
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
    // Idempotente por (tienda, tipo, reference, orden, pago, método). Sin reference
    // no hay clave de deduplicación y se crea siempre.
    const findExisting = (db: Prisma.TransactionClient) =>
      db.cash_register_movements.findFirst({
        where: {
          store_id: data.store_id,
          type: 'refund',
          reference: data.reference,
          order_id: data.order_id ?? null,
          payment_id: data.payment_id ?? null,
          payment_method: data.payment_method,
        },
        select: { id: true },
      });
    const create = async (db: Prisma.TransactionClient) => {
      await this.assertOpenSessionLocked(db, session_id, data.store_id);
      if (data.reference) {
        const existing = await findExisting(db);
        if (existing) return existing;
      }
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
    };
    if (tx) return create(tx);
    try {
      return await this.prisma.$transaction((db) => create(db));
    } catch (error) {
      // No existe índice único por reference (b15 lo descartó: hay referencias
      // repetibles legítimas). La deduplicación real es `findExisting` bajo el
      // lock de la sesión (`assertOpenSessionLocked`). Este P2002 es defensa por
      // si un índice futuro lo cubre; la tx abortada no se reutiliza: se relee.
      if (
        data.reference &&
        (error as { code?: string } | null)?.code === 'P2002'
      ) {
        const existing = await findExisting(
          this.prisma.withoutScope() as unknown as Prisma.TransactionClient,
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * B04/B12 — dinero en efectivo de módulos fuera del POS (separados, CxC,
   * anticipos de reserva, cierre de ruta): un `cash_in`/`cash_out` en la sesión
   * abierta del usuario, DENTRO de la tx del módulo.
   *
   * - Solo efectivo (`cash`). Cualquier otro método, o ausente, no mueve el
   *   cajón: devuelve `null` (nunca se asume efectivo por defecto).
   * - Con `pos.cash_register.enabled` apagado devuelve `null`; encendido y sin
   *   sesión abierta del usuario lanza `CASH_SESSION_REQUIRED_001`.
   * - Bloquea la sesión con `assertOpenSessionLocked` y es idempotente por
   *   `(store_id, source_type, source_id, type)`. Un P2002 del índice único
   *   parcial dentro de la tx aborta la tx completa (Postgres): el lock de la
   *   sesión serializa los reintentos, así que el índice es solo respaldo.
   */
  async recordModuleCashMovement(
    tx: Prisma.TransactionClient,
    data: {
      store_id: number;
      user_id: number;
      direction: 'in' | 'out';
      amount: number;
      payment_method: string | null | undefined;
      source_type: string;
      source_id: number;
      reference?: string;
      notes?: string;
    },
  ) {
    if (data.payment_method !== 'cash') return null;

    const settings = await tx.store_settings.findUnique({
      where: { store_id: data.store_id },
      select: { settings: true },
    });
    const enabled = (
      settings?.settings as {
        pos?: { cash_register?: { enabled?: boolean } };
      } | null
    )?.pos?.cash_register?.enabled;
    if (!enabled) return null;

    const session = await tx.cash_register_sessions.findFirst({
      where: {
        store_id: data.store_id,
        status: 'open',
        opened_by: data.user_id,
      },
      orderBy: [{ opened_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!session) {
      throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    }
    await this.assertOpenSessionLocked(tx, session.id, data.store_id);

    const type = data.direction === 'in' ? 'cash_in' : 'cash_out';
    const existing = await tx.cash_register_movements.findFirst({
      where: {
        store_id: data.store_id,
        source_type: data.source_type,
        source_id: data.source_id,
        type,
      } as Prisma.cash_register_movementsWhereInput,
      select: { id: true },
    });
    if (existing) return existing;

    return tx.cash_register_movements.create({
      data: {
        session_id: session.id,
        store_id: data.store_id,
        user_id: data.user_id,
        type,
        amount: data.amount,
        payment_method: 'cash',
        reference: data.reference,
        notes: data.notes,
        source_type: data.source_type,
        source_id: data.source_id,
      } as Prisma.cash_register_movementsUncheckedCreateInput,
    });
  }

  /**
   * Reserve a durable close guard before an in-place payment confirmation whose
   * cash movement must wait for the order finish. The caller owns the payment
   * transaction so the signal and payment state commit or roll back together.
   */
  async createDeferredSaleCashMovementSignal(
    tx: Prisma.TransactionClient,
    input: Omit<DeferredSaleCashMovementInput, 'failure_id' | 'payment_ids'> & {
      organization_id: number;
    },
  ): Promise<number> {
    await this.assertOpenSessionLocked(tx, input.session_id, input.store_id);
    if (!input.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const row = await tx.accounting_entry_failures.create({
      data: {
        organization_id: input.organization_id,
        store_id: input.store_id,
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        source_id: input.order_id,
        event_payload: {
          version: 1,
          session_id: input.session_id,
          store_id: input.store_id,
          order_id: input.order_id,
          user_id: input.user_id,
          payment_ids: [],
          ready_state: input.ready_state,
          compensation_state: input.compensation_state,
        },
        error_message: 'PENDING_FINISH: sale movement waits for order finish',
      },
    });
    return row.id;
  }

  /** Store the final payment ids in the same transaction that confirmed them. */
  async attachDeferredSaleCashMovementPayments(
    tx: Prisma.TransactionClient,
    input: Pick<DeferredSaleCashMovementInput,
      'failure_id' | 'session_id' | 'store_id' | 'order_id' | 'payment_ids'>,
  ): Promise<void> {
    const row = await tx.accounting_entry_failures.findFirst({
      where: {
        id: input.failure_id,
        store_id: input.store_id,
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        source_id: input.order_id,
        resolved_at: null,
      },
      select: { id: true, event_payload: true },
    });
    const payload = row?.event_payload as Record<string, unknown> | undefined;
    if (!row || Number(payload?.session_id) !== input.session_id) {
      throw new Error(`Deferred cash movement signal #${input.failure_id} is missing or stale`);
    }
    await tx.accounting_entry_failures.update({
      where: { id: input.failure_id },
      data: {
        event_payload: { ...payload, payment_ids: input.payment_ids },
      },
    });
  }

  /** Persist sale movements and resolve the close guard atomically. */
  async completeDeferredSaleCashMovement(
    tx: Prisma.TransactionClient,
    input: DeferredSaleCashMovementInput & {
      movements: Array<{ amount: number; payment_method: string; payment_id: number }>;
    },
  ): Promise<void> {
    await this.assertOpenSessionLocked(tx, input.session_id, input.store_id);
    await tx.$queryRaw`
      SELECT id FROM orders
      WHERE id = ${input.order_id} AND store_id = ${input.store_id}
      FOR UPDATE
    `;
    const order = await tx.orders.findFirst({
      where: { id: input.order_id, store_id: input.store_id },
      select: { id: true, state: true },
    });
    if (!order || !['finished', 'delivered'].includes(order.state)) {
      throw new Error(`Deferred cash movement order #${input.order_id} has not completed its delivery transition`);
    }
    await tx.$queryRaw`
      SELECT id FROM accounting_entry_failures
      WHERE id = ${input.failure_id} AND store_id = ${input.store_id}
      FOR UPDATE
    `;
    const row = await tx.accounting_entry_failures.findFirst({
      where: {
        id: input.failure_id,
        store_id: input.store_id,
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        source_id: input.order_id,
        resolved_at: null,
      },
      select: { id: true, event_payload: true },
    });
    const payload = row?.event_payload as Record<string, unknown> | undefined;
    const expectedIds = Array.isArray(payload?.payment_ids)
      ? (payload.payment_ids as number[]).sort((a, b) => a - b)
      : [];
    const actualIds = input.movements.map((item) => item.payment_id).sort((a, b) => a - b);
    if (
      !row || Number(payload?.session_id) !== input.session_id ||
      payload?.ready_state !== order.state ||
      input.ready_state !== order.state ||
      JSON.stringify(expectedIds) !== JSON.stringify(actualIds)
    ) {
      throw new Error(`Deferred cash movement signal #${input.failure_id} is missing or mismatched`);
    }
    for (const movement of input.movements) {
      const existing = await tx.cash_register_movements.findFirst({
        where: {
          store_id: input.store_id,
          type: 'sale',
          payment_id: movement.payment_id,
        },
        select: { id: true, session_id: true },
      });
      if (existing) {
        if (existing.session_id !== input.session_id) {
          throw new Error(
            `Deferred payment #${movement.payment_id} already belongs to cash session #${existing.session_id}`,
          );
        }
        continue;
      }
      await tx.cash_register_movements.create({
        data: {
          session_id: input.session_id,
          store_id: input.store_id,
          user_id: input.user_id,
          type: 'sale',
          amount: movement.amount,
          payment_method: movement.payment_method,
          order_id: input.order_id,
          payment_id: movement.payment_id,
        },
      });
    }
    await tx.accounting_entry_failures.update({
      where: { id: input.failure_id },
      data: {
        resolved_at: new Date(),
        error_message: 'DELIVERED: deferred sale movements recorded after order finish',
      },
    });
  }

  /** Resolve a deferred signal only after payment compensation and state restore. */
  async cancelDeferredSaleCashMovementSignal(
    tx: Prisma.TransactionClient,
    input: DeferredSaleCashMovementInput & { restored_state: string },
  ): Promise<boolean> {
    await this.assertOpenSessionLocked(tx, input.session_id, input.store_id);
    await tx.$queryRaw`
      SELECT id FROM orders
      WHERE id = ${input.order_id} AND store_id = ${input.store_id}
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT id FROM accounting_entry_failures
      WHERE id = ${input.failure_id} AND store_id = ${input.store_id}
      FOR UPDATE
    `;
    const row = await tx.accounting_entry_failures.findFirst({
      where: {
        id: input.failure_id,
        store_id: input.store_id,
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        source_id: input.order_id,
        resolved_at: null,
      },
      select: { id: true, event_payload: true },
    });
    if (!row) return false;
    const payload = row.event_payload as Record<string, unknown> | undefined;
    if (!payload || Number(payload.session_id) !== input.session_id) {
      return false;
    }
    const paymentIds = Array.isArray(payload.payment_ids) ? payload.payment_ids as number[] : [];
    const [payments, order] = await Promise.all([
      tx.payments.findMany({
        where: { id: { in: paymentIds }, order_id: input.order_id },
        select: { id: true, state: true },
      }),
      tx.orders.findFirst({
        where: { id: input.order_id, store_id: input.store_id },
        select: { id: true, state: true },
      }),
    ]);
    if (
      payments.length !== paymentIds.length ||
      payments.some((payment) => !['pending', 'cancelled'].includes(payment.state)) ||
      order?.state !== input.restored_state
    ) {
      return false;
    }
    await tx.accounting_entry_failures.update({
      where: { id: input.failure_id },
      data: {
        resolved_at: new Date(),
        error_message: 'CANCELLED: payment compensation and order restore completed',
      },
    });
    return true;
  }

  /** Retry committed deferred signals after a process restart. */
  async deliverDeferredSaleCashMovement(failureId: number): Promise<void> {
    const db = this.prisma.withoutScope();
    const candidate = await db.accounting_entry_failures.findFirst({
      where: { id: failureId, handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY },
    });
    if (!candidate || candidate.resolved_at) return;
    const payload = candidate.event_payload as unknown as DeferredSaleCashMovementInput & {
      version: number;
      compensation_state: string;
    };
    if (
      payload.version !== 1 || !Number.isInteger(payload.session_id) ||
      !Number.isInteger(payload.order_id) || !Array.isArray(payload.payment_ids)
    ) {
      throw new Error(`Deferred cash movement signal #${failureId} has an invalid payload`);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assertOpenSessionLocked(tx, payload.session_id, payload.store_id);
      await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${payload.order_id} AND store_id = ${payload.store_id}
        FOR UPDATE
      `;
      const order = await tx.orders.findFirst({
        where: { id: payload.order_id, store_id: payload.store_id },
        select: { id: true, state: true },
      });
      if (!order) return;
      await tx.$queryRaw`
        SELECT id FROM accounting_entry_failures
        WHERE id = ${failureId} AND store_id = ${payload.store_id}
        FOR UPDATE
      `;
      const signal = await tx.accounting_entry_failures.findFirst({
        where: {
          id: failureId,
          store_id: payload.store_id,
          handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
          source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
          resolved_at: null,
        },
        select: { id: true },
      });
      if (!signal) return;

      const payments = await tx.payments.findMany({
        where: { id: { in: payload.payment_ids }, order_id: payload.order_id },
        select: {
          id: true,
          amount: true,
          state: true,
          store_payment_method: {
            select: { system_payment_method: { select: { type: true } } },
          },
        },
      });
      if (payments.length !== payload.payment_ids.length) return;
      if (
        payments.every((payment) => ['pending', 'cancelled'].includes(payment.state)) &&
        order.state === payload.compensation_state
      ) {
        await this.cancelDeferredSaleCashMovementSignal(tx, {
          ...payload,
          failure_id: failureId,
          restored_state: payload.compensation_state,
        });
        return;
      }
      if (
        order.state !== payload.ready_state ||
        payments.some((payment) => payment.state !== 'succeeded')
      ) return;

      await this.completeDeferredSaleCashMovement(tx, {
        ...payload,
        failure_id: failureId,
        movements: payments.map((payment) => ({
          amount: Number(payment.amount),
          payment_method: payment.store_payment_method?.system_payment_method?.type ?? 'cash',
          payment_id: payment.id,
        })),
      });
    });
  }

  /**
   * Resuelve a qué sesión de caja debe asentarse la salida de dinero de un
   * reembolso o cancelación. El efectivo sale del cajón de QUIEN lo entrega, así
   * que la cascada es (B03):
   *  1. la sesión abierta del usuario operador (actor);
   *  2. (la sesión original solo cuenta si es del mismo operador: ya queda
   *     cubierta por el paso 1);
   *  3. `null` — el llamador encola en el outbox hasta que el operador abra caja.
   * Nunca cae en la sesión de otro usuario, ni siquiera de la misma caja.
   *
   * Excepción (`sale_session_first`, B02): la compensación automática de un
   * fallo dentro del mismo cobro va primero a la sesión del `sale` compensado
   * si sigue abierta, y después al operador.
   */
  async resolveCompensationSessionId(
    input: CompensationSessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number | null> {
    const db = (tx ?? this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;

    if (input.sale_session_first) {
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
        const origin_session = await db.cash_register_sessions.findFirst({
          where: { id: sale.session_id, store_id: input.store_id },
          select: { id: true, status: true },
        });
        if (origin_session?.status === 'open') return origin_session.id;
      }
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
    return own?.id ?? null;
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
  /**
   * B17/B18 — who a cash refund/cancellation without a request user is booked
   * to: the cashier of the `sale` of one of its payments, else the order's
   * creator. Webhooks and jobs run without store context, so this reads
   * unscoped and filters by `store_id` explicitly. `null` = nobody.
   */
  async resolveSaleActorId(input: {
    store_id: number;
    order_id: number;
    payment_ids?: (number | null)[];
  }): Promise<number | null> {
    const db = this.prisma.withoutScope();
    const ids = (input.payment_ids ?? []).filter((id): id is number => id != null);
    const sale_of = (where: Prisma.cash_register_movementsWhereInput) =>
      db.cash_register_movements.findFirst({
        where: { store_id: input.store_id, type: 'sale', order_id: input.order_id, ...where },
        orderBy: { id: 'asc' },
        select: { user_id: true },
      });
    const sale =
      (ids.length > 0 ? await sale_of({ payment_id: { in: ids } }) : null) ??
      (await sale_of({}));
    if (sale?.user_id) return sale.user_id;
    const order = await db.orders.findFirst({
      where: { id: input.order_id, store_id: input.store_id },
      select: { created_by_user_id: true },
    });
    return order?.created_by_user_id ?? null;
  }

  async recordRefundCashMovementDurable(input: {
    organization_id: number;
    store_id: number;
    /** `null` only with `force_outbox` (B18: no request user and no actor). */
    user_id: number | null;
    refund_id: number;
    order_id: number;
    payment_id: number | null;
    amount: number;
    channel: string;
    /**
     * Sin usuario real (B18): no hay cajón que descontar, así que el movimiento
     * se encola siempre, con el actor del `sale`, hasta que ese actor tenga caja.
     */
    force_outbox?: boolean;
  }, tx?: Prisma.TransactionClient): Promise<RefundCashMovementOutcome> {
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
    // Cascada B03: sesión abierta del operador. `null` = nadie puede recibirlo
    // ahora → outbox (el barrido usa la misma cascada).
    const actor_id = input.user_id;
    const session_id = input.force_outbox || actor_id == null
      ? null
      : await this.resolveCompensationSessionId(
          {
            store_id: input.store_id,
            user_id: actor_id,
            payment_id: input.payment_id,
            order_id: input.order_id,
          },
          tx,
        );
    if (session_id == null) {
      const failure_id = await this.enqueueRefundCashMovement(
        payload,
        actor_id == null
          ? `${REFUND_NO_ACTOR_PREFIX}: refund without acting user nor sale actor, cash movement queued for manual review`
          : input.force_outbox
            ? 'PENDING_DELIVERY: refund without acting user, cash movement queued for the sale actor'
            : 'PENDING_DELIVERY: no open cash session for refund cash movement',
        tx,
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
        user_id: actor_id!,
        amount: input.amount,
        payment_method: input.channel,
        order_id: input.order_id,
        payment_id: input.payment_id ?? undefined,
        reference: buildRefundCashMovementReference(input.refund_id),
      });
      await this.stampRefundCashSession(
        this.prisma.withoutScope() as unknown as Prisma.TransactionClient,
        input.refund_id,
        session_id,
      );
      return { status: 'recorded', movement_id: movement.id };
    } catch (error) {
      const failure_id = await this.enqueueRefundCashMovement(
        payload,
        `PENDING_DELIVERY: cash movement insert failed — ${error instanceof Error ? error.message : String(error)}`,
        tx,
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
   *  2. sesión destino por `resolveCompensationSessionId` (operador; o, con
   *     `sale_session_first`, la del `sale` compensado primero);
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
      /** Compensación B02 (mismo cobro): sesión del `sale` primero. */
      sale_session_first?: boolean;
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
      ...(input.sale_session_first ? { sale_session_first: true } : {}),
    };

    const session_id = await this.resolveCompensationSessionId(
      {
        store_id: input.store_id,
        user_id: input.user_id,
        payment_id: input.payment_id,
        order_id: input.order_id,
        sale_session_first: input.sale_session_first,
      },
      tx,
    );
    if (session_id == null) {
      const failure_id = await this.enqueueCompensationCashMovement(
        payload,
        'PENDING_DELIVERY: no open cash session for compensation cash movement',
        tx,
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
        tx,
      );
      this.logger.error(
        `Compensation ${input.dedupe_key} (order #${input.order_id}): cash ` +
          `movement insert failed, outbox row #${failure_id}. ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 'pending', failure_id, reason: 'movement_insert_failed' };
    }
  }

  /**
   * B03 — deja en `refunds.cash_session_id` la sesión donde salió el efectivo, para
   * que el cierre no la deduzca por ventana de tiempo. Solo rellena si está vacío
   * (un refund multi-pago conserva la primera sesión) y nunca lanza: es un
   * dato derivado, el movimiento ya quedó escrito.
   */
  async stampRefundCashSession(
    db: Prisma.TransactionClient,
    refund_id: number,
    session_id: number,
  ): Promise<void> {
    if (!(refund_id > 0)) return;
    try {
      await db.refunds.updateMany({
        where: { id: refund_id, cash_session_id: null },
        data: { cash_session_id: session_id },
      } as unknown as Prisma.refundsUpdateManyArgs);
    } catch (error) {
      this.logger.error(
        `Refund #${refund_id}: cash_session_id #${session_id} not stamped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Outbox de compensaciones: una fila abierta como máximo por `dedupe_key`. */
  private async enqueueCompensationCashMovement(
    payload: RefundCashMovementPayload,
    message: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    // A4: dentro de una tx del llamador la fila del outbox se escribe con ella,
    // para que un rollback no deje una salida fantasma en el outbox.
    const db = (tx ??
      this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;
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
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    // A4: dentro de una tx del llamador la fila del outbox se escribe con ella,
    // para que un rollback no deje una salida fantasma en el outbox.
    const db = (tx ??
      this.prisma.withoutScope()) as unknown as Prisma.TransactionClient;
    const existing = await db.accounting_entry_failures.findFirst({
      where: {
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_type: REFUND_CASH_MOVEMENT_SOURCE,
        source_id: payload.refund_id,
        resolved_at: null,
        // Un movimiento por pago en efectivo (B25): una fila abierta por pago.
        ...(payload.payment_id != null
          ? { event_payload: { path: ['payment_id'], equals: payload.payment_id } }
          : {}),
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
      const db = this.prisma.withoutScope();
      // Leer sin lock para descubrir la sesión y la orden. Nunca retener el
      // outbox mientras se espera la sesión: closeSession toma sesión→órdenes→outbox.
      const candidate = await db.accounting_entry_failures.findFirst({
        where: { id: failureId, handler_key: REFUND_CASH_MOVEMENT_KEY },
      });
      if (!candidate || candidate.resolved_at) return;
      const candidate_payload = candidate.event_payload as unknown as RefundCashMovementPayload;

      await db.$transaction(async (tx) => {
        const is_candidate_delivery =
          candidate_payload.delivery_scope === CASH_MOVEMENT_DELIVERY_SCOPE;
        let session_id: number | null = null;
        if (is_candidate_delivery) {
          // B18: no actor to book it to; it stays queued (attempts counted)
          // until someone reviews it. Never a drawer picked at random.
          if (candidate_payload.user_id == null) {
            throw new Error(
              `${REFUND_NO_ACTOR_PREFIX}: refund #${candidate_payload.refund_id} (order #${candidate_payload.order_id}) has no actor; manual review`,
            );
          }
          session_id = await this.resolveCompensationSessionId(
            {
              store_id: candidate_payload.store_id,
              user_id: candidate_payload.user_id,
              payment_id: candidate_payload.payment_id,
              order_id: candidate_payload.order_id,
              sale_session_first: candidate_payload.sale_session_first,
            },
            tx,
          );
          if (session_id == null) {
            throw new Error(
              `NO_OPEN_SESSION: no open cash session owned by user #${candidate_payload.user_id} in store #${candidate_payload.store_id} for refund #${candidate_payload.refund_id}`,
            );
          }
          await this.assertOpenSessionLocked(tx, session_id, candidate_payload.store_id);
          const locked_order = await tx.$queryRaw<{ id: number }[]>`
            SELECT id FROM orders
            WHERE id = ${candidate_payload.order_id}
              AND store_id = ${candidate_payload.store_id}
            FOR UPDATE`;
          if (locked_order.length !== 1) {
            throw new Error(`Refund cash movement order #${candidate_payload.order_id} not found`);
          }
        }

        // Sesión/orden primero; outbox al final. El reread bajo lock evita
        // entregar una fila alterada después de la lectura inicial.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM accounting_entry_failures WHERE id = ${failureId} FOR UPDATE`;
        if (locked.length !== 1) return;
        const row = await tx.accounting_entry_failures.findFirst({
          where: { id: failureId, handler_key: REFUND_CASH_MOVEMENT_KEY },
        });
        if (!row || row.resolved_at) return;
        const payload = row.event_payload as unknown as RefundCashMovementPayload;
        if (JSON.stringify(payload) !== JSON.stringify(candidate_payload)) {
          throw new Error(`Refund cash movement payload changed during delivery #${failureId}`);
        }
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
            // Un refund multi-pago deja un movimiento por pago (B25): el
            // `payment_id` forma parte de la clave de entrega.
            payment_id: payload.payment_id,
            ...(is_compensation ? { order_id: payload.order_id } : {}),
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
        // Cascada B03 (compartida con el camino directo): la sesión abierta del
        // operador. Si nadie puede recibirlo, la fila sigue pendiente.
        // El session_id ya se resolvió y quedó bloqueado antes de la fila outbox.
        const session = { id: session_id! };
        const movement = await tx.cash_register_movements.create({
          data: {
            session_id: session.id,
            store_id: payload.store_id,
            // Non-null: the candidate guard above rejects a payload without
            // actor and the reread payload must equal the candidate.
            user_id: payload.user_id!,
            type: 'refund',
            amount: payload.amount,
            payment_method,
            order_id: payload.order_id,
            payment_id: payload.payment_id,
            reference,
            notes: payload.notes,
          },
        });
        if (!is_compensation) {
          await this.stampRefundCashSession(tx, payload.refund_id, session.id);
        }
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

  @Interval(60_000)
  async sweepDeferredSaleCashMovements(): Promise<void> {
    const rows = await this.prisma.withoutScope().accounting_entry_failures.findMany({
      where: {
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        resolved_at: null,
      },
      select: { id: true },
      take: 50,
      orderBy: { created_at: 'asc' },
    });
    for (const row of rows) {
      try {
        await this.deliverDeferredSaleCashMovement(row.id);
      } catch (error) {
        this.logger.warn(
          `Deferred sale cash movement #${row.id} still pending: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.prisma.withoutScope().accounting_entry_failures.update({
          where: { id: row.id },
          data: {
            attempt_count: { increment: 1 },
            error_message: error instanceof Error ? error.message : String(error),
          },
        });
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
