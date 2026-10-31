import {
  Injectable,
  BadRequestException,
  NotFoundException,
  MessageEvent,
  Logger,
  Inject,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { order_state_enum, Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { QuerySessionDto } from '../dto/query-session.dto';
import {
  MovementsService,
  CASH_MOVEMENT_DELIVERY_SCOPE,
  DEFERRED_SALE_CASH_MOVEMENT_KEY,
  DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
  REFUND_CASH_MOVEMENT_KEY,
  REFUND_CASH_MOVEMENT_SOURCE,
  ORDER_CANCELLED_MOVEMENT_REFERENCE,
} from '../movements/movements.service';
// F-222 — comparación de dinero en centavos enteros (no `Math.abs` en floats).
import { differsByAtLeastCents } from '@common/money-kernel';
import type { SettingsService } from '../../settings/settings.service';
import type {
  CashSessionCloseReport,
  CashConsolidated,
  CashConsolidatedRow,
  CashBreakdown,
  CashOutflow,
  CashInflow,
  CashSalesSummary,
  CashIntegrity,
} from './interfaces/cash-session-close-report.interface';
import {
  computePendingOrderFingerprint,
  computePendingSessionFingerprint,
  getUnpaidBalanceForFinish,
} from '../../orders/order-flow/order-action-policy.util';

/** Dinero en céntimos enteros: evita acumular floats. */
const toCents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number): number => Math.round(c) / 100;

/** Los movimientos manuales (`cash_in`/`cash_out`) siempre son en efectivo. */
const CASH_PAYMENT_METHOD = 'cash';

/**
 * Referencia escrita por el cajero. Devuelve null si está vacía o es una
 * referencia interna del sistema (`refund:<id>`, `payment_cancelled`,
 * `order_cancelled`, `dispatch_route:...`).
 */
export function humanCashReference(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const t = ref.trim();
  if (!t) return null;
  if (
    t.startsWith('refund:') ||
    t === 'payment_cancelled' ||
    t === ORDER_CANCELLED_MOVEMENT_REFERENCE ||
    t.startsWith('dispatch_route:')
  )
    return null;
  return t;
}

/**
 * `cash_out` legado de cancelación de orden (antes de que se registraran como
 * `refund` + `order_cancelled`). Se exige también la nota que escribía el
 * sistema: la referencia sola la puede teclear un cajero en un retiro manual
 * ("Cancelación orden de proveedor") y esas filas no guardan `order_id`.
 */
function isLegacyOrderCancellationCashOut(m: any): boolean {
  return (
    m?.type === 'cash_out' &&
    String(m.reference ?? '').startsWith('Cancelación orden') &&
    String(m.notes ?? '').startsWith(
      'Devolución de efectivo por cancelación de la orden',
    )
  );
}

/** Referencia visible de un movimiento (oculta las internas y la legada). */
const movementReference = (m: any): string | null =>
  isLegacyOrderCancellationCashOut(m) ? null : humanCashReference(m.reference);

const movementUserName = (m: any): string | null =>
  m?.user
    ? `${m.user.first_name ?? ''} ${m.user.last_name ?? ''}`.trim() || null
    : null;

type MovementKind =
  | 'sale'
  | 'cash_in'
  | 'refund'
  | 'cancellation'
  | 'withdrawal';

/**
 * Convención de movimientos de caja → categoría del consolidado.
 * `refund` con `payment_cancelled`/`order_cancelled` y `cash_out` legado
 * (isLegacyOrderCancellationCashOut) son cancelaciones; refund restante = reembolso;
 * cash_out restante = retiro (efectivo). `payment_method` null en `sale` y
 * `refund` → `unknown`: el esperado (computeCashSummary) solo cuenta como
 * efectivo lo que dice `cash`, y el consolidado debe dar la misma cifra.
 */
function classifyMovement(
  m: any,
): { kind: MovementKind; method: string } | null {
  switch (m.type) {
    case 'sale':
      return { kind: 'sale', method: m.payment_method || 'unknown' };
    case 'cash_in':
      return { kind: 'cash_in', method: CASH_PAYMENT_METHOD };
    case 'refund': {
      const method = m.payment_method || 'unknown';
      const ref = m.reference ?? '';
      return ref === 'payment_cancelled' || ref === 'order_cancelled'
        ? { kind: 'cancellation', method }
        : { kind: 'refund', method };
    }
    case 'cash_out':
      return isLegacyOrderCancellationCashOut(m)
        ? { kind: 'cancellation', method: CASH_PAYMENT_METHOD }
        : { kind: 'withdrawal', method: CASH_PAYMENT_METHOD };
    default:
      return null;
  }
}

/**
 * QUI-784 — token de inyección para el `SettingsService` dentro del dominio de
 * cajas. `sessions.service` ↔ `settings.service` tienen dependencia mutua real
 * (caja usa la moneda de la tienda; settings consulta sesiones abiertas para
 * bloquear el apagado del módulo). Si ambas clases se importan por valor, SWC
 * emite `design:paramtypes` con un require circular que revienta en TDZ al
 * arrancar el backend. El token rompe el ciclo a nivel de archivo.
 */
export const SETTINGS_SERVICE = Symbol('SETTINGS_SERVICE');

/**
 * Resumen de sesiones de caja abiertas en una tienda. `registers` está
 * deduplicado por caja para que el mensaje al usuario nombre cada caja una sola
 * vez aunque tenga más de una sesión abierta.
 */
export interface OpenSessionsSummary {
  count: number;
  registers: { id: number; name: string }[];
}

/**
 * QUI-572 — desglose de caja autoritativo. Es el ÚNICO lugar donde vive la
 * aritmética del efectivo esperado: antes se calculaba inline en `closeSession`
 * y otra vez, por separado, en el modal de cierre del frontend. Dos fórmulas
 * que podían divergir sin que nadie se enterara.
 *
 * Claves en snake_case porque este objeto viaja tal cual por la API
 * (`GET store/cash-registers/sessions/:id/cash-summary`).
 */
export interface CashSummary {
  opening: number;
  /** Todas las ventas, sin importar el método de pago. */
  sales_total: number;
  sales_count: number;
  /** Sin etiquetas legibles: traducir el `method` es tarea del frontend. */
  sales_by_method: { method: string; count: number; total: number }[];
  cash_sales: number;
  cash_in: number;
  cash_out: number;
  cash_refunds: number;
  /** El número que gobierna el arqueo. */
  expected_cash_total: number;
  non_cash_total: number;
  /** Consolidado por método (ventas, ingresos, salidas, esperado). */
  consolidated: CashConsolidated;
  /** Desglose del efectivo: apertura + entradas − salidas = esperado. */
  cash_breakdown: CashBreakdown;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly movements_service: MovementsService,
    private readonly event_emitter: EventEmitter2,
    private readonly aiEngine: AIEngineService,
    @Inject(SETTINGS_SERVICE) private readonly settingsService: SettingsService,
  ) {}

  async getActiveSession(user_id?: number) {
    const context = RequestContextService.getContext()!;
    const where: any = {
      store_id: context.store_id,
      status: 'open',
    };
    if (user_id) {
      where.opened_by = user_id;
    }

    return this.prisma.cash_register_sessions.findFirst({
      where,
      orderBy: [{ opened_at: 'desc' }, { id: 'desc' }],
      include: {
        register: true,
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  /**
   * Gate único de caja para cobros de personal: con `pos.cash_register.enabled`,
   * quien cobra (cualquier método) debe tener SU sesión abierta
   * (`getActiveSession` filtra por `opened_by`). `require_session_for_sales`
   * quedó obsoleto: se ignora (se conserva en schema/defaults por
   * compatibilidad). Guardar un borrador POS no
   * pasa por aquí (guardar ≠ cobrar). Fail-closed: sin `userId` no hay sesión
   * propia que encontrar, así que se rechaza en vez de caer al lookup de
   * tienda de `getActiveSession`.
   */
  async assertSessionForSales(userId?: number): Promise<void> {
    const settings = await this.settingsService.getSettings();
    const cashRegister = (settings as any)?.pos?.cash_register;
    if (!cashRegister?.enabled) {
      return;
    }
    const session = userId ? await this.getActiveSession(userId) : null;
    if (!session) {
      throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    }
  }

  /**
   * QUI-560 — sesiones abiertas a nivel de TIENDA, no de usuario.
   *
   * `getActiveSession` filtra por `opened_by`, así que devuelve `null` cuando la
   * sesión viva pertenece a otro operador. Ese predicado no sirve para decidir
   * si la caja de la tienda está en uso: la caja es un recurso de tienda y una
   * sola sesión abierta de cualquier usuario debe bloquear el apagado del
   * módulo. Devuelve además los nombres de caja para que el mensaje de error
   * le diga al usuario exactamente qué tiene que cerrar.
   */
  async countOpenSessions(store_id?: number): Promise<OpenSessionsSummary> {
    const context = RequestContextService.getContext();
    const target_store_id = store_id ?? context?.store_id;

    if (!target_store_id) {
      return { count: 0, registers: [] };
    }

    const open_sessions = await this.prisma.cash_register_sessions.findMany({
      where: { store_id: target_store_id, status: 'open' },
      select: {
        id: true,
        cash_register_id: true,
        register: { select: { id: true, name: true } },
      },
    });

    const registers = new Map<number, string>();
    for (const session of open_sessions) {
      const register_id = session.register?.id ?? session.cash_register_id;
      registers.set(
        register_id,
        session.register?.name ?? `Caja #${register_id}`,
      );
    }

    return {
      count: open_sessions.length,
      registers: [...registers.entries()].map(([id, name]) => ({ id, name })),
    };
  }

  /** Traduce un P2002 de los índices únicos parciales de sesión abierta. */
  private translateOpenSessionConflict(error: unknown): unknown {
    const e = error as { code?: string; meta?: unknown };
    if (e?.code !== 'P2002') return error;
    // `meta.target` trae el nombre del índice (o campos, según el adaptador).
    const text = JSON.stringify(e.meta ?? {});
    if (text.includes('cash_register_sessions_one_open_per_user')) {
      return new BadRequestException('Ya tienes una sesión abierta en otra caja');
    }
    if (text.includes('cash_register_sessions_one_open_per_register')) {
      return new BadRequestException('Esta caja ya tiene una sesión abierta');
    }
    return error;
  }

  async openSession(dto: OpenSessionDto) {
    const context = RequestContextService.getContext()!;

    // Validate cash register exists and is active
    const register = await this.prisma.cash_registers.findFirst({
      where: { id: dto.cash_register_id, is_active: true },
    });
    if (!register) {
      throw new NotFoundException('Caja registradora no encontrada o inactiva');
    }

    // Create session + opening_balance movement in transaction. Las validaciones
    // viven dentro de la tx; los índices únicos parciales (por caja y por usuario)
    // son la garantía final ante aperturas concurrentes.
    const session = await this.prisma.$transaction(async (tx: any) => {
      const existing_session = await tx.cash_register_sessions.findFirst({
        where: { cash_register_id: dto.cash_register_id, status: 'open' },
      });
      if (existing_session) {
        throw new BadRequestException('Esta caja ya tiene una sesión abierta');
      }

      // Una sola sesión abierta o suspendida por usuario
      const user_session = await tx.cash_register_sessions.findFirst({
        where: {
          opened_by: context.user_id,
          status: { in: ['open', 'suspended'] },
        },
      });
      if (user_session) {
        throw new BadRequestException(
          'Ya tienes una sesión abierta en otra caja',
        );
      }

      const created_session = await tx.cash_register_sessions.create({
        data: {
          cash_register_id: dto.cash_register_id,
          store_id: context.store_id,
          opened_by: context.user_id,
          opening_amount: dto.opening_amount,
          status: 'open',
          pending_orders_tracking_enabled: true,
        },
        include: {
          register: true,
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      });

      // Create opening balance movement
      await tx.cash_register_movements.create({
        data: {
          session_id: created_session.id,
          store_id: context.store_id,
          user_id: context.user_id,
          type: 'opening_balance',
          amount: dto.opening_amount,
          payment_method: 'cash',
        },
      });

      return created_session;
    }).catch((error: unknown) => {
      throw this.translateOpenSessionConflict(error);
    });

    // Emit accounting event
    const store = await this.prisma.stores.findUnique({
      where: { id: session.store_id },
      select: { organization_id: true },
    });
    if (store && Number(dto.opening_amount) > 0) {
      this.event_emitter.emit('cash_register.opened', {
        session_id: session.id,
        store_id: session.store_id,
        organization_id: store.organization_id,
        opening_amount: Number(dto.opening_amount),
        user_id: session.opened_by,
      });
    }

    return session;
  }

  async closeSession(session_id: number, dto: CloseSessionDto) {
    const context = RequestContextService.getContext()!;
    const actual_closing_amount = Number(dto.actual_closing_amount);
    const closed_at = new Date();

    const closed_session = await this.prisma.$transaction(async (tx: any) => {
      // Todos los escritores de movimientos/órdenes de esta sesión deben tomar
      // el mismo lock antes de mutar. Nunca decidir el cierre con lecturas previas.
      const locked = await tx.$queryRaw`
        SELECT id FROM cash_register_sessions
        WHERE id = ${session_id} AND store_id = ${context.store_id} AND status = 'open'
        FOR UPDATE
      `;
      if (!Array.isArray(locked) || locked.length !== 1) {
        const current = await tx.cash_register_sessions.findFirst({
          where: { id: session_id, store_id: context.store_id },
          select: { id: true, status: true },
        });
        if (!current)
          throw new NotFoundException('Sesión de caja no encontrada');
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_006);
      }
      const session = await tx.cash_register_sessions.findFirst({
        where: { id: session_id, store_id: context.store_id },
      });
      if (!session) throw new NotFoundException('Sesión de caja no encontrada');
      if (session.status !== 'open') {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_006);
      }

      const origin_orders = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM orders
          WHERE store_id = ${context.store_id}
            AND origin_cash_session_id = ${session_id}
          ORDER BY id
          FOR UPDATE
        `;
      const origin_order_ids = origin_orders.map((order) => order.id);
      if (origin_order_ids.length > 0) {
        const unresolved_refund_movements =
          await tx.accounting_entry_failures.findMany({
            where: {
              store_id: context.store_id,
              handler_key: REFUND_CASH_MOVEMENT_KEY,
              source_type: REFUND_CASH_MOVEMENT_SOURCE,
              resolved_at: null,
              event_payload: {
                path: ['delivery_scope'],
                equals: CASH_MOVEMENT_DELIVERY_SCOPE,
              },
              OR: origin_order_ids.map((order_id) => ({
                event_payload: { path: ['order_id'], equals: order_id },
              })),
            },
            select: { id: true, event_payload: true },
            orderBy: { id: 'asc' },
          });
        if (unresolved_refund_movements.length > 0) {
          throw new VendixHttpException(
            ErrorCodes.CASH_SESSION_PENDING_005,
            'No se puede cerrar la caja mientras haya reembolsos pendientes de registrar en movimientos de caja.',
            {
              failure_ids: unresolved_refund_movements.map((row) => row.id),
              order_ids: unresolved_refund_movements.map((row) =>
                Number(
                  (row.event_payload as Record<string, unknown>)?.order_id,
                ),
              ),
            },
          );
        }
      }

      const unresolved_deferred_sales =
        await tx.accounting_entry_failures.findMany({
          where: {
            store_id: context.store_id,
            handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
            source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
            resolved_at: null,
            event_payload: {
              path: ['session_id'],
              equals: session_id,
            },
          },
          select: { id: true, source_id: true },
          orderBy: { id: 'asc' },
        });
      if (unresolved_deferred_sales.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.CASH_SESSION_PENDING_005,
          'No se puede cerrar la caja mientras haya pagos confirmados esperando que se registre su movimiento de venta.',
          {
            failure_ids: unresolved_deferred_sales.map((row) => row.id),
            order_ids: unresolved_deferred_sales.map((row) => row.source_id),
          },
        );
      }

      const movements = await tx.cash_register_movements.findMany({
        where: { session_id, store_id: context.store_id },
        include: { user: { select: { first_name: true, last_name: true } } },
      });
      const summary_breakdown = this.computeCashSummary(session, movements);
      const expected = summary_breakdown.expected_cash_total;
      const seen = dto.expected_closing_amount_seen;
      if (seen != null && differsByAtLeastCents(Number(seen), expected, 2)) {
        throw new VendixHttpException(
          ErrorCodes.CASH_SESSION_EXPECTED_STALE_001,
          `El efectivo esperado cambió mientras contabas: la pantalla mostraba $${Number(seen).toLocaleString('es-CO')} y ahora son $${expected.toLocaleString('es-CO')}. Revisa el resumen actualizado antes de cerrar.`,
          {
            expected_now: expected,
            expected_seen: Number(seen),
            delta: expected - Number(seen),
          },
        );
      }

      const terminal_states: order_state_enum[] = [
        order_state_enum.finished,
        order_state_enum.delivered,
        order_state_enum.cancelled,
        order_state_enum.refunded,
      ];
      const missing_payment_where = {
        grand_total: { gt: 0 },
        OR: [{ payment_form: { not: '2' } }, { payment_form: null }],
        payments: {
          none: {
            state: {
              in: ['succeeded', 'captured', 'partially_refunded', 'refunded'],
            },
          },
        },
      };
      const pending_orders = session.pending_orders_tracking_enabled
        ? await tx.orders.findMany({
            where: {
              store_id: context.store_id,
              origin_cash_session_id: session_id,
              OR: [
                { state: { notIn: terminal_states } },
                { remaining_balance: { gt: 0 } },
                missing_payment_where,
              ],
            },
            select: {
              id: true,
              order_number: true,
              state: true,
              grand_total: true,
              remaining_balance: true,
              updated_at: true,
            },
            orderBy: { id: 'asc' },
          })
        : [];
      const pending_fingerprint = computePendingSessionFingerprint(pending_orders);
      const tracking_enabled = Boolean(session.pending_orders_tracking_enabled);
      const has_pending = pending_orders.length > 0;
      const decision = dto.pending_decision;
      const override_reason = dto.override_reason?.trim();

      if (!tracking_enabled && has_pending && decision !== 'override') {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_004);
      }
      if (has_pending && !decision) {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_001);
      }
      if (decision === 'override' && !override_reason) {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_003);
      }
      if (decision === 'resolved' && has_pending) {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_002);
      }
      if (
        decision &&
        tracking_enabled &&
        dto.pending_fingerprint !== pending_fingerprint
      ) {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_002);
      }

      const pending_snapshot = {
        version: 1,
        status: tracking_enabled ? 'tracked' : 'untracked',
        rows: pending_orders.map((order) => ({
          id: order.id,
          order_number: order.order_number,
          state: order.state,
          grand_total: Number(order.grand_total ?? 0),
          remaining_balance: Number(order.remaining_balance ?? 0),
        })),
        fingerprint: tracking_enabled ? pending_fingerprint : null,
        decision: decision ?? 'none',
        actor_id: context.user_id,
        decided_at: closed_at.toISOString(),
        override_reason: decision === 'override' ? override_reason : null,
      };
      const difference = new Prisma.Decimal(actual_closing_amount)
        .minus(expected)
        .toNumber();
      const closing_view = {
        ...session,
        status: 'closed',
        actual_closing_amount,
      };
      const consolidated = this.buildConsolidated(closing_view, movements);
      const outflows = await this.buildOutflows(closing_view, movements);
      const inflows = this.buildInflows(closing_view, movements);
      const prev_summary =
        session.summary && typeof session.summary === 'object'
          ? (session.summary as Record<string, unknown>)
          : {};
      const summary = {
        ...prev_summary,
        ...this.generateSessionSummary(movements),
        consolidated: consolidated.consolidated,
        cash_breakdown: consolidated.cash_breakdown,
        outflows,
        inflows,
        pending_orders_snapshot: pending_snapshot,
      };

      const updated = await tx.cash_register_sessions.updateMany({
        where: {
          id: session_id,
          store_id: context.store_id,
          status: 'open',
        },
        data: {
          status: 'closed',
          closed_by: context.user_id,
          closed_at,
          expected_closing_amount: expected,
          actual_closing_amount,
          difference,
          closing_notes: dto.closing_notes,
          summary,
        },
      });

      if (updated.count !== 1) {
        throw new VendixHttpException(ErrorCodes.CASH_SESSION_PENDING_006);
      }

      // Create closing balance movement
      await tx.cash_register_movements.create({
        data: {
          session_id,
          store_id: context.store_id,
          user_id: context.user_id,
          type: 'closing_balance',
          amount: actual_closing_amount,
          payment_method: 'cash',
        },
      });

      const updated_session = await tx.cash_register_sessions.findFirst({
        where: { id: session_id, store_id: context.store_id },
        include: {
          register: true,
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          closed_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      });

      if (!updated_session) {
        throw new NotFoundException('Sesión de caja no encontrada');
      }

      return updated_session;
    });

    // Emit accounting event
    const store = await this.prisma.stores.findUnique({
      where: { id: closed_session.store_id },
      select: { organization_id: true },
    });
    if (store) {
      this.event_emitter.emit('cash_register.closed', {
        session_id: closed_session.id,
        store_id: closed_session.store_id,
        organization_id: store.organization_id,
        expected_amount: Number(closed_session.expected_closing_amount),
        actual_amount: Number(closed_session.actual_closing_amount),
        difference: Number(closed_session.difference),
        user_id: closed_session.closed_by,
      });
    }

    return closed_session;
  }

  async suspendSession(session_id: number) {
    const context = RequestContextService.getContext()!;
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id, store_id: context.store_id },
    });
    if (!session) {
      throw new NotFoundException('Sesión de caja abierta no encontrada');
    }
    if (session.status !== 'open') {
      throw new BadRequestException('La sesión de caja ya no está abierta');
    }

    const updated = await this.prisma.cash_register_sessions.updateMany({
      where: { id: session_id, store_id: context.store_id, status: 'open' },
      data: { status: 'suspended' },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('La sesión de caja ya no está abierta');
    }

    const suspended_session =
      await this.prisma.cash_register_sessions.findFirst({
        where: { id: session_id, store_id: context.store_id },
      });
    if (!suspended_session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    return suspended_session;
  }

  async findAll(query: QuerySessionDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.cash_register_id) where.cash_register_id = query.cash_register_id;
    if (query.date_from || query.date_to) {
      where.opened_at = {};
      if (query.date_from) where.opened_at.gte = new Date(query.date_from);
      if (query.date_to) where.opened_at.lte = new Date(query.date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.cash_register_sessions.findMany({
        where,
        include: {
          register: { select: { id: true, name: true, code: true } },
          opened_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          closed_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
        orderBy: { opened_at: query.sort_order || 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.cash_register_sessions.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit },
    };
  }

  async findOne(session_id: number) {
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id },
      include: {
        register: true,
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        movements: {
          include: {
            user: { select: { id: true, first_name: true, last_name: true } },
            order: { select: { id: true, order_number: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    return session;
  }

  /**
   * Lista autoritativa de trabajo pendiente originado en esta sesión.
   * `origin_cash_session_id` identifica dónde nació la orden; movimientos y
   * fecha/cajero no se usan para inferirlo. El saldo es informativo y nunca
   * participa en el cálculo del efectivo esperado.
   */
  async getPendingOrders(session_id: number, query: QuerySessionDto = {}) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (store_id === undefined) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id, store_id },
      select: {
        id: true,
        store_id: true,
        pending_orders_tracking_enabled: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.limit) || 10)),
    );
    const ownership_where = {
      store_id: session.store_id,
      origin_cash_session_id: session.id,
    };
    const terminal_states: order_state_enum[] = [
      order_state_enum.finished,
      order_state_enum.delivered,
      order_state_enum.cancelled,
      order_state_enum.refunded,
    ];
    const operational_where = {
      ...ownership_where,
      state: { notIn: terminal_states },
    };
    const missing_payment_where = {
      grand_total: { gt: 0 },
      OR: [{ payment_form: { not: '2' } }, { payment_form: null }],
      payments: {
        none: {
          state: {
            in: ['succeeded', 'captured', 'partially_refunded', 'refunded'],
          },
        },
      },
    };
    const where = {
      ...ownership_where,
      OR: [
        { state: { notIn: terminal_states } },
        { remaining_balance: { gt: 0 } },
        missing_payment_where,
      ],
    };
    const [total, operational_count, rows, pending_snapshot_rows] = await Promise.all([
      this.prisma.orders.count({ where }),
      this.prisma.orders.count({ where: operational_where }),
      this.prisma.orders.findMany({
        where,
        select: {
          id: true,
          order_number: true,
          state: true,
          remaining_balance: true,
          updated_at: true,
          delivery_type: true,
          shipping_method_id: true,
          shipping_cost: true,
          grand_total: true,
          payment_form: true,
          payments: { select: { state: true, amount: true } },
          order_items: { select: { delivered_at: true, cancelled_at: true } },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      // El fingerprint de cierre debe cubrir toda la unión, aunque el cliente
      // solo esté mostrando una página. Este segundo read acotado por tienda
      // y sesión incluye los importes/pagos necesarios para calcular saldos
      // reales; su costo crece linealmente con las órdenes pendientes.
      this.prisma.orders.findMany({
        where,
        select: {
          id: true,
          state: true,
          remaining_balance: true,
          updated_at: true,
          grand_total: true,
          payment_form: true,
          payments: { select: { state: true, amount: true } },
          order_items: { select: { delivered_at: true, cancelled_at: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    const fingerprint = computePendingSessionFingerprint(pending_snapshot_rows);
    const effectiveBalance = (order: any) =>
      Math.max(
        Number(order.remaining_balance ?? 0),
        getUnpaidBalanceForFinish(order),
      );
    const balance_count = pending_snapshot_rows.filter(
      (order) => effectiveBalance(order) > 0.01,
    ).length;
    const balance_total = pending_snapshot_rows.reduce(
      (sum, order) => sum + effectiveBalance(order),
      0,
    );

    const data = rows.map((order) => {
      const balance = Number(order.remaining_balance ?? 0);
      const payment_amount_due = effectiveBalance(order);
      const operational = !terminal_states.includes(order.state);
      const all_items_delivered = this.allOrderItemsDelivered(order.order_items);
      const version = order.updated_at?.toISOString?.() ?? null;
      const fingerprint = computePendingOrderFingerprint(order, version);
      return {
        id: order.id,
        order_number: order.order_number,
        state: order.state,
        remaining_balance: balance,
        payment_required: payment_amount_due > 0.01,
        payment_amount_due,
        delivery_type: order.delivery_type,
        all_items_delivered,
        shipping_method_id: order.shipping_method_id,
        shipping_cost: Number(order.shipping_cost ?? 0),
        reasons: [
          ...(operational ? ['operational'] : []),
          ...(payment_amount_due > 0.01 ? ['balance'] : []),
        ],
        version,
        fingerprint,
      };
    });

    return {
      tracking_enabled: session.pending_orders_tracking_enabled,
      legacy_unattributed: session.pending_orders_tracking_enabled
        ? null
        : {
            status: 'untracked',
            message:
              'Esta sesión no registra atribución de órdenes; las órdenes sin origen no se asignan por inferencia.',
          },
      count: total,
      operational_count,
      balance_count,
      balance_total: Math.round(balance_total * 100) / 100,
      fingerprint,
      page,
      limit,
      data,
    };
  }

  private allOrderItemsDelivered(
    items: Array<{ delivered_at: Date | null; cancelled_at: Date | null }> | null | undefined,
  ): boolean {
    if (!items?.length) return false;
    const deliverable = items.filter((item) => !item.cancelled_at);
    return deliverable.length > 0 && deliverable.every((item) => item.delivered_at != null);
  }

  async getSessionReport(session_id: number) {
    const session = await this.findOne(session_id);
    const saved_summary =
      session.summary && typeof session.summary === 'object'
        ? (session.summary as Record<string, unknown>)
        : {};

    const movements_by_type = this.groupMovementsByType(session.movements);
    const movements_by_method = this.groupMovementsByPaymentMethod(
      session.movements,
    );

    // QUI-784 — el resumen IA del cierre mostraba "USD" hardcodeado porque la
    // plantilla del AI app y formatGrouped inyectaban `$` literal. Cargamos la
    // moneda real de la tienda para que el prompt refleje el símbolo correcto
    // y el AI deje de etiquetar todo como USD por defecto.
    const currency_code = await this.settingsService.getStoreCurrency();
    const currency_symbol = this.currencySymbolFor(currency_code);

    return {
      session: {
        id: session.id,
        register: session.register,
        opened_by: session.opened_by_user,
        closed_by: session.closed_by_user,
        status: session.status,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
        opening_amount: session.opening_amount,
        expected_closing_amount: session.expected_closing_amount,
        actual_closing_amount: session.actual_closing_amount,
        difference: session.difference,
        closing_notes: session.closing_notes,
      },
      summary: {
        by_type: movements_by_type,
        by_payment_method: movements_by_method,
        total_movements: session.movements.length,
      },
      pending_orders_snapshot: saved_summary['pending_orders_snapshot'] ?? null,
      currency: { code: currency_code, symbol: currency_symbol },
    };
  }

  /**
   * Mapa mínimo de código ISO → símbolo. Mantenido chico a propósito: si la
   * tienda usa una moneda que no está acá, caemos a `$` y el AI lo aclara en el
   * código ISO. El AI app ya no debe inventar la etiqueta.
   */
  private currencySymbolFor(code: string): string {
    const upper = code.toUpperCase();
    if (upper === 'EUR' || upper === '€') return '€';
    if (upper === 'GBP' || upper === '£') return '£';
    if (
      upper === 'MXN' ||
      upper === 'COP' ||
      upper === 'ARS' ||
      upper === 'CLP'
    )
      return '$';
    return '$';
  }

  /**
   * QUI-572 — desglose de caja fresco para una sesión, calculado por el backend.
   *
   * Existe para que el modal de cierre pueda REFRESCAR el efectivo esperado en
   * vez de recalcularlo por su cuenta con una fórmula paralela. Funciona igual
   * sobre sesiones abiertas y cerradas: sobre una sesión cerrada devuelve el
   * mismo desglose que gobernó su arqueo.
   */
  async getCashSummary(session_id: number): Promise<CashSummary> {
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id },
    });
    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    const movements = await this.prisma.cash_register_movements.findMany({
      where: { session_id },
    });

    return this.computeCashSummary(session, movements);
  }

  /**
   * Reporte consolidado de la sesión (cierre e historial). Solo agregados.
   * El efectivo sale de `computeCashSummary` (QUI-572, fuente única); aquí solo
   * se suman conteos y se agregan descuentos/reembolsos alrededor.
   */
  async getCloseReport(session_id: number): Promise<CashSessionCloseReport> {
    const session = await this.prisma.cash_register_sessions.findFirst({
      where: { id: session_id },
      include: {
        register: { select: { id: true, name: true, code: true } },
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }

    const movements = await this.prisma.cash_register_movements.findMany({
      where: { session_id },
      include: { user: { select: { first_name: true, last_name: true } } },
    });
    const summary = this.computeCashSummary(session, movements);
    const snap: any =
      session.status === 'closed' && session.summary ? session.summary : {};
    const consolidated: CashConsolidated =
      snap.consolidated ?? summary.consolidated;
    const cash_breakdown: CashBreakdown =
      snap.cash_breakdown ?? summary.cash_breakdown;
    let outflows: CashOutflow[] =
      snap.outflows ?? (await this.buildOutflows(session, movements));
    if (snap.outflows) {
      // Snapshot anterior a reference/notes: completar en lectura (sin escribir).
      const by_id = new Map<number, any>(movements.map((m: any) => [m.id, m]));
      outflows = (outflows as any[]).map((o) => {
        if (o.reference !== undefined && o.notes !== undefined) return o;
        const m = by_id.get(o.id);
        return {
          ...o,
          reference:
            o.reference !== undefined
              ? o.reference
              : m
                ? movementReference(m)
                : null,
          notes:
            o.notes !== undefined
              ? o.notes
              : m
                ? m.notes?.trim() || null
                : null,
        } as CashOutflow;
      });
    }
    const inflows: CashInflow[] =
      snap.inflows ?? this.buildInflows(session, movements);
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const fullName = (u: any) =>
      u ? { id: u.id, name: `${u.first_name} ${u.last_name}`.trim() } : null;

    // Conteos de efectivo: misma regla que computeCashSummary para el total.
    const cnt = { cash_in: 0, cash_out: 0, cash_refunds: 0 };
    const cancellations = { count: 0, total: 0 };
    for (const m of movements) {
      if (m.type === 'cash_in') cnt.cash_in++;
      else if (m.type === 'cash_out') cnt.cash_out++;
      else if (m.type === 'refund') {
        if (m.payment_method === 'cash') cnt.cash_refunds++;
        // Anulación de pago: cuenta en cash_refunds (si es efectivo) pero se
        // reporta aparte y NO entra en refunds.count/total.
        if (m.reference === 'payment_cancelled') {
          cancellations.count++;
          cancellations.total += Number(m.amount);
        }
      }
    }

    // --- Órdenes de la sesión ---
    // Un pago dividido entre sesiones toca la misma orden en dos cajas: la
    // orden se atribuye a la sesión de su PRIMER movimiento `sale`.
    const sale_movements = movements.filter((m) => m.type === 'sale');
    const candidate_ids: number[] = [
      ...new Set<number>(
        sale_movements.map((m) => m.order_id).filter((v): v is number => !!v),
      ),
    ];
    let order_ids: number[] = [];
    const sale_all_by_order = new Map<number, number>();
    if (candidate_ids.length) {
      const all_sales = await this.prisma.cash_register_movements.findMany({
        where: { type: 'sale', order_id: { in: candidate_ids } },
        select: {
          id: true,
          type: true,
          order_id: true,
          session_id: true,
          amount: true,
          created_at: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      });
      const first_session = new Map<number, number>();
      for (const m of all_sales) {
        if (m.type !== undefined && m.type !== 'sale') continue;
        sale_all_by_order.set(
          m.order_id!,
          (sale_all_by_order.get(m.order_id!) ?? 0) + toCents(m.amount),
        );
        if (!first_session.has(m.order_id!)) {
          first_session.set(m.order_id!, m.session_id);
        }
      }
      order_ids = candidate_ids.filter(
        (id) => first_session.get(id) === session_id,
      );
    }

    const orders = order_ids.length
      ? await this.prisma.orders.findMany({
          where: { id: { in: order_ids } },
          select: {
            id: true,
            subtotal_amount: true,
            discount_amount: true,
            tax_amount: true,
            shipping_cost: true,
            shipping_tax_amount: true,
            tip_amount: true,
            grand_total: true,
            coupon_code: true,
            order_number: true,
            state: true,
          },
        })
      : [];

    const is_void = (o: any) =>
      o.state === 'cancelled' || o.state === 'refunded';
    const live_orders = orders.filter((o: any) => !is_void(o));
    const void_orders = orders.filter((o: any) => is_void(o));
    const aggregate = (list: any[]) => {
      let c = {
        subtotal: 0,
        discounts: 0,
        product_taxes: 0,
        shipping_taxes: 0,
        shipping: 0,
        tips: 0,
        grand_total: 0,
      };
      for (const o of list) {
        c.subtotal += toCents(o.subtotal_amount);
        c.discounts += toCents(o.discount_amount);
        c.product_taxes += toCents(o.tax_amount);
        c.shipping_taxes += toCents(o.shipping_tax_amount);
        c.shipping += toCents(o.shipping_cost) - toCents(o.shipping_tax_amount);
        c.tips += toCents(o.tip_amount);
        c.grand_total += toCents(o.grand_total);
      }
      return c;
    };
    const live = aggregate(live_orders);
    const void_total_c = aggregate(void_orders).grand_total;
    const sales_collected_c = sale_movements.reduce(
      (t: number, m: any) => t + toCents(m.amount),
      0,
    );

    let subtotal = 0;
    let discounts = 0;
    let product_taxes = 0;
    let shipping_taxes = 0;
    let shipping = 0;
    let tips = 0;
    let grand_total = 0;
    for (const o of orders) {
      subtotal += Number(o.subtotal_amount);
      discounts += Number(o.discount_amount);
      product_taxes += Number(o.tax_amount);
      shipping_taxes += Number(o.shipping_tax_amount ?? 0);
      // `shipping_cost` es BRUTO (incluye su impuesto): se reporta neto.
      shipping +=
        Number(o.shipping_cost ?? 0) - Number(o.shipping_tax_amount ?? 0);
      tips += Number(o.tip_amount ?? 0);
      grand_total += Number(o.grand_total);
    }
    const taxes = product_taxes + shipping_taxes;

    // --- Descuentos ---
    const discounted = orders.filter((o) => Number(o.discount_amount) > 0);
    const discounted_ids = discounted.map((o) => o.id);
    const [order_promos, coupon_uses] = discounted_ids.length
      ? await Promise.all([
          this.prisma.order_promotions.findMany({
            // Filas en 0 = promociones que dejaron de aplicar tras una edición:
            // no se cuentan ni se suman.
            where: { order_id: { in: discounted_ids }, discount_amount: { gt: 0 } },
            select: {
              order_id: true,
              discount_amount: true,
              promotions: { select: { name: true } },
            },
          }),
          this.prisma.coupon_uses.findMany({
            where: { order_id: { in: discounted_ids } },
            select: {
              order_id: true,
              discount_applied: true,
              coupon: { select: { code: true } },
            },
          }),
        ])
      : [[], []];

    const promo_map = new Map<string, { count: number; total: number }>();
    const explained = new Set<number>();
    let promos_total = 0;
    for (const p of order_promos as any[]) {
      const name = p.promotions?.name ?? 'Promoción';
      const b = promo_map.get(name) ?? { count: 0, total: 0 };
      b.count++;
      b.total += Number(p.discount_amount);
      promo_map.set(name, b);
      promos_total += Number(p.discount_amount);
      explained.add(p.order_id);
    }

    // Cupones: monto real desde coupon_uses. Si la orden trae `coupon_code` sin
    // coupon_use, se cuenta con monto 0 (no se inventa un monto).
    const coupon_map = new Map<string, { count: number; total: number }>();
    const with_use = new Set<number>();
    let coupons_total = 0;
    for (const c of coupon_uses as any[]) {
      const code = c.coupon?.code ?? 'CUPÓN';
      const b = coupon_map.get(code) ?? { count: 0, total: 0 };
      b.count++;
      b.total += Number(c.discount_applied);
      coupon_map.set(code, b);
      coupons_total += Number(c.discount_applied);
      with_use.add(c.order_id);
      explained.add(c.order_id);
    }
    for (const o of discounted) {
      if (o.coupon_code && !with_use.has(o.id)) {
        const b = coupon_map.get(o.coupon_code) ?? { count: 0, total: 0 };
        b.count++;
        coupon_map.set(o.coupon_code, b);
        explained.add(o.id);
      }
    }

    // --- Reembolsos ---
    // Vínculo exacto por `refunds.cash_session_id` (B03) o `refund:<id>`; solo los
    // refunds sin sesión registrada (legacy) caen en la heurística por ventana y
    // cajero. Dedupe por id.
    const linked_ids = movements
      .filter((m) => m.type === 'refund' && m.reference?.startsWith('refund:'))
      .map((m) => Number(m.reference!.slice('refund:'.length)))
      .filter((n) => Number.isInteger(n));
    const cashier_ids = [
      ...new Set([session.opened_by, session.closed_by].filter((v) => !!v)),
    ] as number[];
    const window_end = session.closed_at ?? new Date();
    const refunds_rows = await this.prisma.refunds.findMany({
      where: {
        // Solo reembolsos con salida de dinero en curso o hecha: una solicitud
        // pendiente de aprobación aún no sale de la caja ni del medio de pago.
        state: { in: ['approved', 'processing', 'completed'] },
        OR: [
          ...(linked_ids.length ? [{ id: { in: linked_ids } }] : []),
          { cash_session_id: session.id },
          {
            cash_session_id: null,
            processed_at: { gte: session.opened_at, lte: window_end },
            processed_by_user_id: { in: cashier_ids },
          },
        ],
      },
      select: {
        id: true,
        amount: true,
        tax_refund: true,
        refund_method: true,
      },
    });
    const refund_map = new Map<string, { count: number; total: number }>();
    let refunds_total = 0;
    let refunds_tax = 0;
    for (const rf of refunds_rows) {
      const method = rf.refund_method || 'unknown';
      const b = refund_map.get(method) ?? { count: 0, total: 0 };
      b.count++;
      b.total += Number(rf.amount);
      refund_map.set(method, b);
      refunds_total += Number(rf.amount);
      refunds_tax += Number((rf as any).tax_refund ?? 0);
    }

    const closed = session.status === 'closed';
    // Sesión cerrada: el reporte reproduce la decisión y el saldo congelados al
    // cierre. Sesión abierta: solo muestra cobranzas atribuidas a esta sesión.
    const pending_snapshot = (session.summary as any)?.pending_orders_snapshot;
    const pending_orders =
      closed && pending_snapshot
        ? (pending_snapshot.rows ?? []).filter(
            (order: any) => Number(order.remaining_balance ?? 0) > 0.01,
          )
        : session.status === 'open' && session.pending_orders_tracking_enabled
          ? await this.prisma.orders.findMany({
              where: {
                store_id: session.store_id,
                origin_cash_session_id: session.id,
                remaining_balance: { gt: 0.01 },
              },
              select: { remaining_balance: true },
            })
          : [];
    const pending_total = pending_orders.reduce(
      (sum: number, o: any) => sum + Number(o.remaining_balance ?? 0),
      0,
    );

    const currency_code = await this.settingsService.getStoreCurrency();
    const groupOut = <K extends string>(
      map: Map<string, { count: number; total: number }>,
      key: K,
    ) =>
      [...map.entries()]
        .map(([k, v]) => ({
          [key]: k,
          count: v.count,
          total: r2(v.total),
        }))
        .sort((a: any, b: any) => b.total - a.total);

    const sales_summary_block: CashSalesSummary = {
      orders_count: live_orders.length,
      payments_count: sale_movements.length,
      subtotal: fromCents(live.subtotal),
      discounts: fromCents(live.discounts),
      product_taxes: fromCents(live.product_taxes),
      shipping_taxes: fromCents(live.shipping_taxes),
      taxes: fromCents(live.product_taxes + live.shipping_taxes),
      shipping: fromCents(live.shipping),
      tips: fromCents(live.tips),
      grand_total: fromCents(sales_collected_c),
      orders_grand_total: fromCents(live.grand_total),
      average_ticket: live_orders.length
        ? fromCents(live.grand_total / live_orders.length)
        : 0,
      cancelled: {
        count: void_orders.length,
        total: fromCents(void_total_c),
      },
    };

    // Coherencia: lo cobrado en la sesión vs consolidado y vs las órdenes.
    const integrity_notes: string[] = [];
    const consolidated_sales_c = consolidated.rows.reduce(
      (t, r) => t + toCents(r.sales),
      0,
    );
    let sales_match = consolidated_sales_c === sales_collected_c;
    if (!sales_match) {
      integrity_notes.push(
        `Las ventas del consolidado (${fromCents(consolidated_sales_c)}) no igualan los movimientos de venta de la sesión (${fromCents(sales_collected_c)}).`,
      );
    }
    for (const o of live_orders as any[]) {
      const total_c = toCents(o.grand_total);
      const session_c = sale_movements
        .filter((m: any) => m.order_id === o.id)
        .reduce((t: number, m: any) => t + toCents(m.amount), 0);
      const all_c = sale_all_by_order.get(o.id) ?? session_c;
      const label = o.order_number ? `#${o.order_number}` : `id ${o.id}`;
      if (all_c !== session_c) {
        sales_match = false;
        integrity_notes.push(
          `Orden ${label}: pagada en parte en otra sesión (esta sesión ${fromCents(session_c)} de ${fromCents(all_c)} cobrado).`,
        );
      }
      if (all_c < total_c) {
        sales_match = false;
        integrity_notes.push(
          `Orden ${label}: cobrado ${fromCents(all_c)} de ${fromCents(total_c)} (pago parcial o saldo pendiente).`,
        );
      } else if (all_c > total_c) {
        sales_match = false;
        integrity_notes.push(
          `Orden ${label}: cobrado ${fromCents(all_c)} excede el total ${fromCents(total_c)}.`,
        );
      }
    }
    const integrity: CashIntegrity = { sales_match, notes: integrity_notes };

    return {
      session: {
        id: session.id,
        status: session.status,
        register: session.register
          ? {
              id: session.register.id,
              name: session.register.name,
              code: session.register.code ?? null,
            }
          : null,
        opened_by: fullName(session.opened_by_user),
        closed_by: fullName(session.closed_by_user),
        opened_at: session.opened_at.toISOString(),
        closed_at: session.closed_at ? session.closed_at.toISOString() : null,
        closing_notes: session.closing_notes ?? null,
      },
      currency: {
        code: currency_code,
        symbol: this.currencySymbolFor(currency_code),
      },
      cash: {
        opening: r2(summary.opening),
        cash_sales: r2(summary.cash_sales),
        cash_in: { count: cnt.cash_in, total: r2(summary.cash_in) },
        cash_out: { count: cnt.cash_out, total: r2(summary.cash_out) },
        cash_refunds: {
          count: cnt.cash_refunds,
          total: r2(summary.cash_refunds),
        },
        // Cerrada: manda lo persistido en el arqueo, no un recálculo.
        expected: r2(
          closed && session.expected_closing_amount != null
            ? Number(session.expected_closing_amount)
            : summary.expected_cash_total,
        ),
        declared:
          closed && session.actual_closing_amount != null
            ? r2(Number(session.actual_closing_amount))
            : null,
        difference:
          closed && session.difference != null
            ? r2(Number(session.difference))
            : null,
      },
      consolidated,
      cash_breakdown,
      outflows,
      inflows,
      sales_summary: sales_summary_block,
      integrity,
      payment_methods: summary.sales_by_method.map((m) => ({
        method: m.method,
        count: m.count,
        total: r2(m.total),
      })),
      sales: {
        orders_count: orders.length,
        payments_count: sale_movements.length,
        subtotal: r2(subtotal),
        discounts: r2(discounts),
        product_taxes: r2(product_taxes),
        shipping_taxes: r2(shipping_taxes),
        taxes: r2(taxes),
        shipping: r2(shipping),
        tips: r2(tips),
        grand_total: r2(grand_total),
        average_ticket: orders.length ? r2(grand_total / orders.length) : 0,
      },
      refunds: {
        count: refunds_rows.length,
        total: r2(refunds_total),
        by_method: groupOut(refund_map, 'method') as any,
        payment_cancellations: {
          count: cancellations.count,
          total: r2(cancellations.total),
        },
      },
      returns: {
        refunds_count: refunds_rows.length,
        refunds_total: r2(refunds_total),
        refunds_tax: r2(refunds_tax),
        payments_cancelled_count: cancellations.count,
        payments_cancelled_total: r2(cancellations.total),
      },
      net: {
        net_sales: r2(grand_total - refunds_total - cancellations.total),
        net_taxes: r2(taxes - refunds_tax),
      },
      pending_collection: {
        count: pending_orders.length,
        total: r2(pending_total),
      },
      discounts: {
        orders_with_discount: discounted.length,
        total: r2(discounts),
        promotions: groupOut(promo_map, 'name') as any,
        coupons: groupOut(coupon_map, 'code') as any,
        other: {
          count: discounted.filter((o) => !explained.has(o.id)).length,
          total: r2(Math.max(0, discounts - promos_total - coupons_total)),
        },
      },
      generated_at: new Date().toISOString(),
    };
  }

  streamClosingSummary(sessionId: number): Observable<MessageEvent> {
    // Capture request context before entering the Observable async callback,
    // because AsyncLocalStorage is lost inside the Observable's IIFE.
    const context = RequestContextService.getContext();

    return new Observable<MessageEvent>((subscriber) => {
      const run = async () => {
        try {
          const report = await this.getSessionReport(sessionId);
          const variables = this.buildAISummaryVariables(report);

          try {
            // Try streaming first
            let accumulatedText = '';
            for await (const chunk of this.aiEngine.runStream(
              'cash_register_closing_summary',
              variables,
            )) {
              if (chunk.type === 'text' && chunk.content) {
                accumulatedText += chunk.content;
              }

              if (chunk.type === 'done') {
                const pendingOrdersSection =
                  this.pendingOrdersSummarySection(report);
                const fullSummary = `${accumulatedText}${pendingOrdersSection}`;
                if (fullSummary) {
                  await this.saveAiSummary(sessionId, fullSummary);
                }
                if (pendingOrdersSection) {
                  subscriber.next({
                    data: JSON.stringify({
                      type: 'text',
                      content: pendingOrdersSection,
                    }),
                    type: 'ai-chunk',
                  } as MessageEvent);
                }
                subscriber.next({
                  data: JSON.stringify(chunk),
                  type: 'ai-chunk',
                } as MessageEvent);
                subscriber.complete();
                return;
              }

              if (chunk.type === 'error') {
                subscriber.next({
                  data: JSON.stringify(chunk),
                  type: 'ai-chunk',
                } as MessageEvent);
                subscriber.complete();
                return;
              }

              subscriber.next({
                data: JSON.stringify(chunk),
                type: 'ai-chunk',
              } as MessageEvent);
            }
            subscriber.complete();
          } catch {
            // Fallback to non-streaming
            try {
              const result = await this.aiEngine.run(
                'cash_register_closing_summary',
                variables,
              );
              const pendingOrdersSection =
                this.pendingOrdersSummarySection(report);
              const fullSummary = `${result.content ?? ''}${pendingOrdersSection}`;
              if (fullSummary) {
                await this.saveAiSummary(sessionId, fullSummary);
              }
              subscriber.next({
                data: JSON.stringify({ type: 'text', content: fullSummary }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.next({
                data: JSON.stringify({
                  type: 'done',
                  usage: result.usage,
                }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.complete();
            } catch (fallbackError: any) {
              subscriber.next({
                data: JSON.stringify({
                  type: 'error',
                  error: fallbackError.message,
                }),
                type: 'ai-chunk',
              } as MessageEvent);
              subscriber.complete();
            }
          }
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', error: error.message }),
            type: 'ai-chunk',
          } as MessageEvent);
          subscriber.complete();
        }
      };

      // Re-inject the captured request context into the async callback
      if (context) {
        RequestContextService.run(context, () => {
          run();
        });
      } else {
        run();
      }
    });
  }

  private pendingOrdersSummarySection(report: any): string {
    const snapshot = report.pending_orders_snapshot;
    if (!snapshot) return '';

    const heading = '\n\n### Órdenes que no se finalizaron\n';
    if (snapshot.status === 'untracked') {
      return `${heading}No se pudo confirmar cuáles órdenes quedaron pendientes porque esta sesión no tenía seguimiento.`;
    }

    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    if (rows.length === 0) return `${heading}No quedaron órdenes pendientes.`;

    const currencyCode = report.currency?.code || 'COP';
    const currencySymbol = report.currency?.symbol || '$';
    const stateLabels: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pago pendiente',
      processing: 'En proceso',
      shipped: 'Enviada',
      delivered: 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };

    const orderLines = rows.map((row: any) => {
      const state = stateLabels[String(row.state).toLowerCase()] ?? row.state;
      const total = Number(row.grand_total ?? 0);
      const balance = Number(row.remaining_balance ?? 0);
      const totalText =
        row.grand_total != null
          ? ` · Total ${currencySymbol}${total.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${currencyCode}`
          : '';
      const balanceText =
        balance > 0
          ? ` · Falta cobrar ${currencySymbol}${balance.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${currencyCode}`
          : '';
      return `- ${row.order_number} · ${state}${totalText}${balanceText}`;
    });

    return `${heading}${orderLines.join('\n')}`;
  }

  private buildAISummaryVariables(report: any): Record<string, string> {
    const s = report.session;
    const summary = report.summary;
    const currency_code = report.currency?.code || 'USD';
    const currency_symbol = report.currency?.symbol || '$';

    const formatUser = (user: any) =>
      user ? `${user.first_name} ${user.last_name}` : 'N/A';

    const formatDate = (date: any) =>
      date ? new Date(date).toLocaleString('es-CO') : 'N/A';

    const formatDecimal = (value: any) =>
      value != null ? String(Number(value)) : '0';

    // QUI-784 — antes hardcodeaba `$${val.total}` y forzaba al AI a etiquetar
    // todo como USD. Ahora usa el símbolo real y acompaña del código ISO para
    // que el AI no se confunda entre COP/USD (ambos usan `$`).
    const formatGrouped = (
      grouped: Record<string, { count: number; total: number }>,
    ) =>
      Object.entries(grouped)
        .map(
          ([key, val]) =>
            `- ${key}: ${val.count} movimiento(s), total ${currency_symbol}${val.total} ${currency_code}`,
        )
        .join('\n') || 'Sin datos';

    return {
      register_name: s.register?.name || 'N/A',
      opened_by: formatUser(s.opened_by),
      closed_by: formatUser(s.closed_by),
      opened_at: formatDate(s.opened_at),
      closed_at: formatDate(s.closed_at),
      opening_amount: formatDecimal(s.opening_amount),
      expected_closing_amount: formatDecimal(s.expected_closing_amount),
      actual_closing_amount: formatDecimal(s.actual_closing_amount),
      difference: formatDecimal(s.difference),
      closing_notes: s.closing_notes || 'Sin notas',
      summary_by_method: formatGrouped(summary.by_payment_method),
      summary_by_type: formatGrouped(summary.by_type),
      total_movements: String(summary.total_movements),
      // QUI-784 — variables explícitas de moneda. El AI app las usa en la
      // plantilla del prompt para no inventar la etiqueta.
      currency_code,
      currency_symbol,
    };
  }

  /**
   * QUI-572 — fuente única de la aritmética de caja.
   *
   * `expected_cash_total` reproduce exactamente la fórmula que vivía inline en
   * `closeSession`: parte de la apertura, suma ventas en efectivo y `cash_in`,
   * resta devoluciones en efectivo y `cash_out`. Los movimientos
   * `opening_balance` / `closing_balance` no participan — la apertura ya entra
   * por `session.opening_amount` y contarla otra vez la duplicaría.
   */
  private computeCashSummary(session: any, movements: any[]): CashSummary {
    const D = (v: unknown) => new Prisma.Decimal((v as any) ?? 0);
    const opening_d = D(session.opening_amount);
    const opening = opening_d.toNumber();

    let sales_total_d = new Prisma.Decimal(0);
    let sales_count = 0;
    let cash_sales_d = new Prisma.Decimal(0);
    let cash_in_d = new Prisma.Decimal(0);
    let cash_out_d = new Prisma.Decimal(0);
    let cash_refunds_d = new Prisma.Decimal(0);

    const by_method = new Map<string, { count: number; total: Prisma.Decimal }>();

    for (const m of movements) {
      const amount = D(m.amount);
      const is_cash = m.payment_method === 'cash';

      switch (m.type) {
        case 'sale': {
          const method = m.payment_method || 'unknown';
          const bucket = by_method.get(method) ?? { count: 0, total: new Prisma.Decimal(0) };
          bucket.count++;
          bucket.total = bucket.total.plus(amount);
          by_method.set(method, bucket);

          sales_total_d = sales_total_d.plus(amount);
          sales_count++;
          if (is_cash) cash_sales_d = cash_sales_d.plus(amount);
          break;
        }
        case 'cash_in':
          cash_in_d = cash_in_d.plus(amount);
          break;
        case 'refund':
          if (is_cash) cash_refunds_d = cash_refunds_d.plus(amount);
          break;
        case 'cash_out':
          cash_out_d = cash_out_d.plus(amount);
          break;
      }
    }

    // `cash` primero y el resto alfabético: la UI hace poll de este endpoint y
    // un orden inestable haría saltar las filas entre refrescos.
    const sales_by_method = [...by_method.entries()]
      .map(([method, val]) => ({ method, count: val.count, total: val.total.toNumber() }))
      .sort((a, b) => {
        if (a.method === b.method) return 0;
        if (a.method === 'cash') return -1;
        if (b.method === 'cash') return 1;
        return a.method.localeCompare(b.method);
      });

    const sales_total = sales_total_d.toNumber();
    const cash_sales = cash_sales_d.toNumber();
    const cash_in = cash_in_d.toNumber();
    const cash_out = cash_out_d.toNumber();
    const cash_refunds = cash_refunds_d.toNumber();
    const expected_cash_total = opening_d
      .plus(cash_sales_d)
      .plus(cash_in_d)
      .minus(cash_refunds_d)
      .minus(cash_out_d)
      .toNumber();
    const non_cash_total = sales_total_d.minus(cash_sales_d).toNumber();

    const { consolidated, cash_breakdown } = this.buildConsolidated(
      session,
      movements,
    );

    return {
      opening,
      sales_total,
      sales_count,
      sales_by_method,
      cash_sales,
      cash_in,
      cash_out,
      cash_refunds,
      expected_cash_total,
      non_cash_total,
      consolidated,
      cash_breakdown,
    };
  }

  /**
   * Consolidado por método en céntimos enteros. NO toca `expected_cash_total`
   * (fórmula original arriba). Para efectivo `expected = opening + entered −
   * exited`; coincide siempre con el esperado original.
   */
  private buildConsolidated(
    session: any,
    movements: any[],
  ): { consolidated: CashConsolidated; cash_breakdown: CashBreakdown } {
    type Acc = {
      sales: number;
      cash_in: number;
      refunds: number;
      cancellations: number;
      withdrawals: number;
    };
    const blank = (): Acc => ({
      sales: 0,
      cash_in: 0,
      refunds: 0,
      cancellations: 0,
      withdrawals: 0,
    });
    const acc = new Map<string, Acc>();
    acc.set('cash', blank());
    for (const m of movements) {
      const c = classifyMovement(m);
      if (!c) continue;
      const a = acc.get(c.method) ?? blank();
      const cents = toCents(m.amount);
      if (c.kind === 'sale') a.sales += cents;
      else if (c.kind === 'cash_in') a.cash_in += cents;
      else if (c.kind === 'refund') a.refunds += cents;
      else if (c.kind === 'cancellation') a.cancellations += cents;
      else a.withdrawals += cents;
      acc.set(c.method, a);
    }

    const opening_c = toCents(session.opening_amount);
    const closed =
      session.status === 'closed' && session.actual_closing_amount != null;
    const counted_c = closed ? toCents(session.actual_closing_amount) : null;

    const rows_c = [...acc.entries()].map(([method, a]) => {
      const entered = a.sales + a.cash_in;
      const exited = a.refunds + a.cancellations + a.withdrawals;
      const expected = (method === 'cash' ? opening_c : 0) + entered - exited;
      return { method, a, entered, exited, expected };
    });
    rows_c.sort((x, y) => {
      if (x.method === y.method) return 0;
      if (x.method === 'cash') return -1;
      if (y.method === 'cash') return 1;
      return y.entered - x.entered || x.method.localeCompare(y.method);
    });

    const rows: CashConsolidatedRow[] = rows_c.map((r) => {
      const is_cash = r.method === 'cash';
      return {
        method: r.method,
        sales: fromCents(r.a.sales),
        cash_in: fromCents(r.a.cash_in),
        entered: fromCents(r.entered),
        refunds: fromCents(r.a.refunds),
        cancellations: fromCents(r.a.cancellations),
        withdrawals: fromCents(r.a.withdrawals),
        exited: fromCents(r.exited),
        expected: fromCents(r.expected),
        counted: is_cash && counted_c != null ? fromCents(counted_c) : null,
        difference:
          is_cash && counted_c != null
            ? fromCents(counted_c - r.expected)
            : null,
      };
    });

    const cash = rows_c.find((r) => r.method === 'cash')!;
    return {
      consolidated: {
        rows,
        totals: {
          entered: fromCents(rows_c.reduce((t, r) => t + r.entered, 0)),
          exited: fromCents(rows_c.reduce((t, r) => t + r.exited, 0)),
          expected: fromCents(rows_c.reduce((t, r) => t + r.expected, 0)),
        },
      },
      cash_breakdown: {
        opening: fromCents(opening_c),
        sales: fromCents(cash.a.sales),
        cash_in: fromCents(cash.a.cash_in),
        refunds: fromCents(cash.a.refunds),
        cancellations: fromCents(cash.a.cancellations),
        withdrawals: fromCents(cash.a.withdrawals),
        expected: fromCents(cash.expected),
        counted: counted_c != null ? fromCents(counted_c) : null,
        difference:
          counted_c != null ? fromCents(counted_c - cash.expected) : null,
      },
    };
  }

  /**
   * Lista única de salidas (reembolsos, anulaciones/cancelaciones, retiros),
   * ordenada por fecha. Resuelve número de orden, motivo del reembolso
   * (`refund:<id>`) y nombre del usuario cuando es posible.
   */
  private async buildOutflows(
    session: any,
    movements: any[],
  ): Promise<CashOutflow[]> {
    const outs = movements
      .map((m) => ({ m, c: classifyMovement(m) }))
      .filter(
        (x) =>
          x.c &&
          (x.c.kind === 'refund' ||
            x.c.kind === 'cancellation' ||
            x.c.kind === 'withdrawal'),
      ) as {
      m: any;
      c: { kind: 'refund' | 'cancellation' | 'withdrawal'; method: string };
    }[];
    if (!outs.length) return [];

    const refund_ids = [
      ...new Set(
        outs
          .map(({ m }) => String(m.reference ?? ''))
          .filter((r) => r.startsWith('refund:'))
          .map((r) => Number(r.slice('refund:'.length)))
          .filter((n) => Number.isInteger(n)),
      ),
    ];
    const order_ids = [
      ...new Set(
        outs.map(({ m }) => m.order_id).filter((v: any): v is number => !!v),
      ),
    ];
    const [refund_rows, order_rows] = await Promise.all([
      refund_ids.length
        ? this.prisma.refunds.findMany({
            where: { id: { in: refund_ids } },
            select: { id: true, reason: true },
          })
        : [],
      order_ids.length
        ? this.prisma.orders.findMany({
            where: { id: { in: order_ids } },
            select: { id: true, order_number: true },
          })
        : [],
    ]);
    const reason_by_refund = new Map<number, string | null>(
      (refund_rows as any[]).map((r) => [r.id, r.reason ?? null]),
    );
    const number_by_order = new Map<number, string | null>(
      (order_rows as any[]).map((o) => [o.id, o.order_number ?? null]),
    );

    return outs
      .map(({ m, c }) => {
        const ref = String(m.reference ?? '');
        const refund_reason = ref.startsWith('refund:')
          ? (reason_by_refund.get(Number(ref.slice('refund:'.length))) ?? null)
          : null;
        const at = m.created_at
          ? new Date(m.created_at).toISOString()
          : new Date(session.opened_at ?? 0).toISOString();
        return {
          id: m.id,
          at,
          kind: c.kind,
          order_id: m.order_id ?? null,
          order_number: m.order_id
            ? (number_by_order.get(m.order_id) ?? null)
            : null,
          payment_method: c.method,
          amount: fromCents(toCents(m.amount)),
          reason: m.notes || refund_reason || null,
          reference: movementReference(m),
          notes: m.notes?.trim() || null,
          user_name: movementUserName(m),
        } as CashOutflow;
      })
      .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  }

  /** Entradas manuales (`cash_in`) de la sesión, por fecha ascendente. */
  private buildInflows(session: any, movements: any[]): CashInflow[] {
    return movements
      .filter((m) => m.type === 'cash_in')
      .map(
        (m) =>
          ({
            id: m.id,
            at: m.created_at
              ? new Date(m.created_at).toISOString()
              : new Date(session.opened_at ?? 0).toISOString(),
            amount: fromCents(toCents(m.amount)),
            reference: movementReference(m),
            notes: m.notes?.trim() || null,
            user_name: movementUserName(m),
            payment_method: CASH_PAYMENT_METHOD,
          }) as CashInflow,
      )
      .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  }

  private generateSessionSummary(movements: any[]) {
    const by_method: Record<string, { count: number; total: number }> = {};
    const by_type: Record<string, { count: number; total: number }> = {};

    for (const m of movements) {
      if (m.type === 'opening_balance' || m.type === 'closing_balance')
        continue;

      const method = m.payment_method || 'unknown';
      if (!by_method[method]) by_method[method] = { count: 0, total: 0 };
      by_method[method].count++;
      by_method[method].total += Number(m.amount);

      if (!by_type[m.type]) by_type[m.type] = { count: 0, total: 0 };
      by_type[m.type].count++;
      by_type[m.type].total += Number(m.amount);
    }

    return { by_method, by_type };
  }

  private groupMovementsByType(movements: any[]) {
    const result: Record<string, { count: number; total: number }> = {};
    for (const m of movements) {
      if (!result[m.type]) result[m.type] = { count: 0, total: 0 };
      result[m.type].count++;
      result[m.type].total += Number(m.amount);
    }
    return result;
  }

  private groupMovementsByPaymentMethod(movements: any[]) {
    const result: Record<string, { count: number; total: number }> = {};
    for (const m of movements) {
      if (m.type === 'opening_balance' || m.type === 'closing_balance')
        continue;
      const method = m.payment_method || 'unknown';
      if (!result[method]) result[method] = { count: 0, total: 0 };
      result[method].count++;
      result[method].total += Number(m.amount);
    }
    return result;
  }

  private async saveAiSummary(
    sessionId: number,
    summary: string,
  ): Promise<void> {
    try {
      const context = RequestContextService.getContext();
      const result = await this.prisma.cash_register_sessions.updateMany({
        where: {
          id: sessionId,
          ...(context?.store_id ? { store_id: context.store_id } : {}),
        },
        data: { ai_summary: summary },
      });
      if (result.count !== 1) {
        this.logger.warn(
          `AI summary target session ${sessionId} was not updated`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to save AI summary for session ${sessionId}: ${error.message}`,
      );
      // Don't throw — saving the summary is best-effort, don't break the stream
    }
  }
}
