import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../common/errors';
import {
  StoreActivityService,
  StoreActivitySummary,
} from '../superadmin/stores/activity/store-activity.service';
import { PlatformCrmContext } from './platform-store.guard';
import { PlatformCoveredStore, PlatformCrmLinksService } from './platform-crm-links.service';
import {
  PlatformStoreActivityQueryDto,
  SubscriptionMovementType,
  SubscriptionMovementsQueryDto,
} from './dto/platform-crm-links.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ventana por defecto del historial: 12 meses. Máximo: 24. */
export const MOVEMENTS_DEFAULT_MONTHS = 12;
export const MOVEMENTS_MAX_DAYS = 731;
export const MOVEMENTS_DEFAULT_LIMIT = 20;
/** Tope por fuente: el volumen real son decenas por año por tienda. */
const MOVEMENTS_SOURCE_CAP = 1000;
/** Ventana máxima de la gráfica de actividad (D4). */
export const ACTIVITY_MAX_DAYS = 180;
const FAILURE_REASON_MAX = 140;

/** Eventos de suscripción que se muestran (B.2); el resto es ruido interno. */
export const MOVEMENT_EVENT_TYPES = [
  'plan_changed',
  'cancelled',
  'reactivated',
  'trial_started',
  'trial_ended',
  'state_transition',
  'chargeback_received',
  'renewal_failed',
  'scheduled_cancel',
] as const;

/** Estados en que la suscripción cuenta para el valor mensual y la renovación. */
const BILLABLE_STATES = ['active', 'grace_soft', 'grace_hard'] as const;
/** Meses por ciclo de cobro; `lifetime` no tiene valor mensual. */
const CYCLE_MONTHS: Record<string, number | null> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  lifetime: null,
};

export interface MoneyAmount {
  currency: string;
  amount: number;
}

/**
 * Un movimiento: forma homogénea para los tres tipos (los campos que no
 * aplican van en `null`). Candado 7 ampliado: SOLO estas llaves; nunca
 * `metadata`, `line_items`, `split_breakdown`, `gateway_reference`, `payload`
 * ni nada de partners/comisiones. El spec fija el conjunto.
 */
export interface SubscriptionMovement {
  key: string;
  type: SubscriptionMovementType;
  date: Date;
  store_id: number;
  store_name: string;
  /** Estado de la factura o del pago. */
  state: string | null;
  invoice_number: string | null;
  total: number | null;
  amount_paid: number | null;
  due_at: Date | null;
  change_kind: string | null;
  amount: number | null;
  currency: string | null;
  payment_method: string | null;
  failure_reason: string | null;
  event_type: string | null;
  from_state: string | null;
  to_state: string | null;
  from_plan_name: string | null;
  to_plan_name: string | null;
}

export interface SubscriptionMetrics {
  /** Pagos exitosos en la ventana, netos de reembolsos, por moneda. */
  total_paid: MoneyAmount[];
  last_payment: { date: Date; amount: number; currency: string; store_id: number } | null;
  next_renewal_at: Date | null;
  /** Facturas vencidas hoy (fuera de la ventana: es deuda vigente). */
  overdue_count: number;
  overdue_balance: MoneyAmount[];
  /** Suscripciones activas o en gracia, normalizadas a mensual. */
  monthly_value: MoneyAmount[];
}

export interface CoveredStoreView {
  store_id: number;
  store_name: string;
  organization_name: string;
  plan_name: string | null;
  subscription_state: string | null;
}

export interface SubscriptionMovementsView {
  window: { from: string; to: string };
  stores: CoveredStoreView[];
  summary: {
    total: SubscriptionMetrics;
    by_store: Array<{ store_id: number } & SubscriptionMetrics>;
  };
  items: SubscriptionMovement[];
  pagination: { page: number; limit: number; total: number; has_more: boolean };
}

export interface PlatformStoreActivityView {
  store: { store_id: number; store_name: string; organization_name: string };
  window: { from: string; to: string; days: number };
  summary: StoreActivitySummary;
  series: {
    days: Array<{
      date: string;
      orders: number;
      revenue_operating: number;
      audit_events: number;
      logins: number;
    }>;
    by_channel: Record<string, number>;
    by_state: Record<string, number>;
  };
}

type Window = { start: Date; end: Date };

/** Pago tal como entra al cálculo (con el neto ya resuelto). */
interface PaymentFact {
  store_id: number;
  state: string;
  amount: number;
  net: number;
  currency: string;
  date: Date;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function formatUtcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseUtcDay(value: string): Date {
  const match = DATE_ONLY.exec(value);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
  if (!date || formatUtcDay(date) !== value) {
    throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_014, `Fecha inválida: ${value}`);
  }
  return date;
}

function addMoney(bucket: Map<string, number>, currency: string, amount: number): void {
  bucket.set(currency, (bucket.get(currency) ?? 0) + amount);
}

function moneyList(bucket: Map<string, number>): MoneyAmount[] {
  return [...bucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }));
}

/**
 * Reembolso guardado por `SubscriptionPaymentService.refund` en `metadata`.
 * El estado del pago cambia aunque la pasarela rechace el reembolso; solo
 * `refund_result: 'failed'` dice que el dinero nunca salió. Filas antiguas sin
 * `refund_result` se toman como reembolso exitoso (comportamiento previo).
 */
function refundOf(metadata: Prisma.JsonValue | null): { failed: boolean; amount: number } {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { failed: false, amount: 0 };
  }
  const meta = metadata as Record<string, unknown>;
  const value = Number(meta.refund_amount);
  return {
    failed: meta.refund_result === 'failed',
    amount: Number.isFinite(value) && value > 0 ? value : 0,
  };
}

/** Solo los ids de plan del payload de `plan_changed`; el payload nunca sale. */
function planIdsOf(payload: Prisma.JsonValue | null): { from: number | null; to: number | null } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { from: null, to: null };
  }
  const record = payload as Record<string, unknown>;
  const id = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
  return { from: id(record.from_plan_id), to: id(record.to_plan_id) };
}

/**
 * Cuenta Vendix · movimientos de suscripción y actividad de los comercios
 * enlazados (odd/tasks/cuenta-vendix-multi-movimientos.md §3-§4, D1/D3/D4).
 *
 * SOLO LECTURA y en vivo: no copia, no sincroniza, no escribe nada en la org
 * enlazada ni en la tienda Vendix Platform. Toda consulta lleva `select`
 * literal y toda respuesta se arma campo por campo (candado 7 ampliado). Todo
 * `store_id` se valida contra los comercios que cubren los enlaces activos del
 * cliente en esta tienda plataforma (anti-IDOR).
 */
@Injectable()
export class PlatformCrmAccountService {
  private readonly logger = new Logger(PlatformCrmAccountService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly links: PlatformCrmLinksService,
    private readonly activity: StoreActivityService,
  ) {}

  private get db() {
    return this.prisma.withoutScope();
  }

  async getSubscriptionMovements(
    ctx: PlatformCrmContext,
    customerId: number,
    query: SubscriptionMovementsQueryDto,
  ): Promise<SubscriptionMovementsView> {
    const covered = await this.links.resolveCoveredStores(ctx, customerId);
    if (query.store_id !== undefined && !covered.some((s) => s.store_id === query.store_id)) {
      throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_015);
    }
    const window = this.resolveMovementsWindow(query.from, query.to);
    const page = query.page ?? 1;
    const limit = query.limit ?? MOVEMENTS_DEFAULT_LIMIT;
    const windowView = {
      from: formatUtcDay(window.start),
      to: formatUtcDay(new Date(window.end.getTime() - DAY_MS)),
    };

    if (covered.length === 0) {
      return {
        window: windowView,
        stores: [],
        summary: { total: this.emptyMetrics(), by_store: [] },
        items: [],
        pagination: { page, limit, total: 0, has_more: false },
      };
    }

    const storeIds = covered.map((s) => s.store_id);
    const names = new Map(covered.map((s) => [s.store_id, s.store_name]));
    const range = { gte: window.start, lt: window.end };

    const [invoices, payments, events, overdue, subscriptions] = await Promise.all([
      this.db.subscription_invoices.findMany({
        where: {
          store_id: { in: storeIds },
          state: { not: 'draft' },
          OR: [{ issued_at: range }, { issued_at: null, created_at: range }],
        },
        select: {
          id: true,
          store_id: true,
          invoice_number: true,
          state: true,
          total: true,
          amount_paid: true,
          currency: true,
          due_at: true,
          change_kind: true,
          issued_at: true,
          created_at: true,
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: MOVEMENTS_SOURCE_CAP,
      }),
      this.db.subscription_payments.findMany({
        where: {
          invoice: { store_id: { in: storeIds } },
          OR: [{ paid_at: range }, { paid_at: null, created_at: range }],
        },
        select: {
          id: true,
          state: true,
          amount: true,
          currency: true,
          payment_method: true,
          failure_reason: true,
          paid_at: true,
          created_at: true,
          invoice: { select: { store_id: true } },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: MOVEMENTS_SOURCE_CAP,
      }),
      this.db.subscription_events.findMany({
        where: {
          type: { in: [...MOVEMENT_EVENT_TYPES] },
          created_at: range,
          store_subscription: { store_id: { in: storeIds } },
        },
        select: {
          id: true,
          type: true,
          from_state: true,
          to_state: true,
          payload: true,
          created_at: true,
          store_subscription: { select: { store_id: true } },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: MOVEMENTS_SOURCE_CAP,
      }),
      // Deuda vigente: no depende de la ventana.
      this.db.subscription_invoices.findMany({
        where: { store_id: { in: storeIds }, state: 'overdue' },
        select: { store_id: true, total: true, amount_paid: true, currency: true },
        take: MOVEMENTS_SOURCE_CAP,
      }),
      this.db.store_subscriptions.findMany({
        where: { store_id: { in: storeIds } },
        select: {
          store_id: true,
          state: true,
          effective_price: true,
          currency: true,
          next_billing_at: true,
          current_period_end: true,
          plan: { select: { name: true, billing_cycle: true } },
        },
      }),
    ]);
    for (const [label, rows] of [
      ['invoices', invoices],
      ['payments', payments],
      ['events', events],
    ] as const) {
      if (rows.length >= MOVEMENTS_SOURCE_CAP) {
        this.logger.warn(
          `subscription movements for customer ${customerId}: ${label} hit the ${MOVEMENTS_SOURCE_CAP} cap`,
        );
      }
    }

    // Reembolsos: el monto devuelto y si la pasarela lo aceptó viven solo en
    // `metadata` del pago. Se leen aparte, para esos pagos, y no salen de aquí.
    const refundIds = payments
      .filter((p) => p.state === 'partial_refund' || p.state === 'refunded')
      .map((p) => p.id);
    const refunds = new Map<number, { failed: boolean; amount: number }>();
    if (refundIds.length) {
      const rows = await this.db.subscription_payments.findMany({
        where: { id: { in: refundIds } },
        select: { id: true, metadata: true },
      });
      for (const row of rows) refunds.set(row.id, refundOf(row.metadata));
    }

    // Nombres de plan de los cambios de plan (solo ids del payload).
    const planIds = new Set<number>();
    const eventPlans = new Map<number, { from: number | null; to: number | null }>();
    for (const event of events) {
      if (event.type !== 'plan_changed') continue;
      const ids = planIdsOf(event.payload);
      eventPlans.set(event.id, ids);
      if (ids.from) planIds.add(ids.from);
      if (ids.to) planIds.add(ids.to);
    }
    const planNames = new Map<number, string>();
    if (planIds.size) {
      const plans = await this.db.subscription_plans.findMany({
        where: { id: { in: [...planIds] } },
        select: { id: true, name: true },
      });
      for (const plan of plans) planNames.set(plan.id, plan.name);
    }

    const blank = {
      state: null,
      invoice_number: null,
      total: null,
      amount_paid: null,
      due_at: null,
      change_kind: null,
      amount: null,
      currency: null,
      payment_method: null,
      failure_reason: null,
      event_type: null,
      from_state: null,
      to_state: null,
      from_plan_name: null,
      to_plan_name: null,
    };
    const movements: SubscriptionMovement[] = [];
    for (const invoice of invoices) {
      movements.push({
        key: `invoice:${invoice.id}`,
        type: 'invoice',
        date: invoice.issued_at ?? invoice.created_at,
        store_id: invoice.store_id,
        store_name: names.get(invoice.store_id) ?? '',
        ...blank,
        state: invoice.state,
        invoice_number: invoice.invoice_number,
        total: Number(invoice.total),
        amount_paid: Number(invoice.amount_paid),
        currency: invoice.currency,
        due_at: invoice.due_at,
        change_kind: invoice.change_kind ?? null,
      });
    }
    const paymentFacts: PaymentFact[] = [];
    for (const payment of payments) {
      const storeId = payment.invoice.store_id;
      const amount = Number(payment.amount);
      const date = payment.paid_at ?? payment.created_at;
      movements.push({
        key: `payment:${payment.id}`,
        type: 'payment',
        date,
        store_id: storeId,
        store_name: names.get(storeId) ?? '',
        ...blank,
        state: payment.state,
        amount,
        currency: payment.currency,
        payment_method: payment.payment_method ?? null,
        failure_reason: payment.failure_reason
          ? payment.failure_reason.slice(0, FAILURE_REASON_MAX)
          : null,
      });
      // Un reembolso que la pasarela rechazó no devolvió dinero: cuenta entero.
      const refund = refunds.get(payment.id);
      const net =
        payment.state === 'succeeded' || refund?.failed
          ? amount
          : payment.state === 'partial_refund'
            ? Math.max(0, amount - (refund?.amount ?? 0))
            : 0;
      paymentFacts.push({
        store_id: storeId,
        state: payment.state,
        amount,
        net,
        currency: payment.currency,
        date,
      });
    }
    for (const event of events) {
      const storeId = event.store_subscription.store_id;
      const plans = eventPlans.get(event.id);
      movements.push({
        key: `event:${event.id}`,
        type: 'event',
        date: event.created_at,
        store_id: storeId,
        store_name: names.get(storeId) ?? '',
        ...blank,
        event_type: event.type,
        from_state: event.from_state ?? null,
        to_state: event.to_state ?? null,
        from_plan_name: plans?.from ? (planNames.get(plans.from) ?? null) : null,
        to_plan_name: plans?.to ? (planNames.get(plans.to) ?? null) : null,
      });
    }

    const filtered = movements
      .filter((m) => query.store_id === undefined || m.store_id === query.store_id)
      .filter((m) => query.type === undefined || m.type === query.type)
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.key.localeCompare(a.key));
    const items = filtered.slice((page - 1) * limit, page * limit);

    const subsByStore = new Map(subscriptions.map((s) => [s.store_id, s]));
    const metricsFor = (ids: Set<number>): SubscriptionMetrics =>
      this.computeMetrics(
        paymentFacts.filter((p) => ids.has(p.store_id)),
        overdue.filter((o) => ids.has(o.store_id)),
        subscriptions.filter((s) => ids.has(s.store_id)),
      );

    return {
      window: windowView,
      stores: covered.map((store) => this.storeView(store, subsByStore.get(store.store_id))),
      summary: {
        total: metricsFor(new Set(storeIds)),
        by_store: storeIds.map((id) => ({ store_id: id, ...metricsFor(new Set([id])) })),
      },
      items,
      pagination: {
        page,
        limit,
        total: filtered.length,
        has_more: page * limit < filtered.length,
      },
    };
  }

  /**
   * Gráfica de actividad de un comercio enlazado (D4): la misma que Superadmin
   * (`StoreActivityService.getSeries`, agregados por día, canal y estado) más
   * la fila resumen, SIN el timeline de `getDetail` (números de orden, correos).
   */
  async getStoreActivity(
    ctx: PlatformCrmContext,
    customerId: number,
    storeId: number,
    query: PlatformStoreActivityQueryDto,
  ): Promise<PlatformStoreActivityView> {
    const covered = await this.links.resolveCoveredStores(ctx, customerId);
    const store = covered.find((s) => s.store_id === storeId);
    if (!store) throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_015);

    let window: { start: Date; end: Date; days: number };
    try {
      window = this.activity.resolveWindow(query.from, query.to);
    } catch {
      throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_014);
    }
    if (window.days > ACTIVITY_MAX_DAYS) {
      throw new VendixHttpException(
        ErrorCodes.PLATFORM_CRM_014,
        `La ventana de actividad no puede pasar de ${ACTIVITY_MAX_DAYS} días`,
      );
    }
    const from = formatUtcDay(window.start);
    const to = formatUtcDay(new Date(window.end.getTime() - DAY_MS));

    const [summary, series] = await Promise.all([
      this.activity.getSummary(storeId, window),
      this.activity.getSeries(storeId, { from, to }),
    ]);
    const counts = (record: Record<string, number>) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(value)]));

    return {
      store: {
        store_id: store.store_id,
        store_name: store.store_name,
        organization_name: store.organization_name,
      },
      window: { from, to, days: window.days },
      summary: {
        score: summary.score,
        orders_count: summary.orders_count,
        revenue_operating: summary.revenue_operating,
        active_users: summary.active_users,
        audit_events: summary.audit_events,
        last_activity_at: summary.last_activity_at,
      },
      series: {
        days: series.days.map((day) => ({
          date: day.date,
          orders: day.orders,
          revenue_operating: day.revenue_operating,
          audit_events: day.audit_events,
          logins: day.logins,
        })),
        by_channel: counts(series.by_channel),
        by_state: counts(series.by_state),
      },
    };
  }

  /** `from`/`to` inclusivos en UTC; por defecto los últimos 12 meses. */
  private resolveMovementsWindow(from?: string, to?: string): Window {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date((to ? parseUtcDay(to) : today).getTime() + DAY_MS);
    let start: Date;
    if (from) {
      start = parseUtcDay(from);
    } else {
      const last = new Date(end.getTime() - DAY_MS);
      start = new Date(
        Date.UTC(
          last.getUTCFullYear(),
          last.getUTCMonth() - MOVEMENTS_DEFAULT_MONTHS,
          last.getUTCDate(),
        ) + DAY_MS,
      );
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days < 1) {
      throw new VendixHttpException(ErrorCodes.PLATFORM_CRM_014, 'from debe ser anterior a to');
    }
    if (days > MOVEMENTS_MAX_DAYS) {
      throw new VendixHttpException(
        ErrorCodes.PLATFORM_CRM_014,
        `La ventana del historial no puede pasar de ${MOVEMENTS_MAX_DAYS} días`,
      );
    }
    return { start, end };
  }

  private computeMetrics(
    payments: PaymentFact[],
    overdue: Array<{
      total: Prisma.Decimal;
      amount_paid: Prisma.Decimal;
      currency: string;
    }>,
    subscriptions: Array<{
      state: string;
      effective_price: Prisma.Decimal;
      currency: string;
      next_billing_at: Date | null;
      current_period_end: Date | null;
      plan: { name: string; billing_cycle: string } | null;
    }>,
  ): SubscriptionMetrics {
    const paid = new Map<string, number>();
    let last: PaymentFact | null = null;
    for (const payment of payments) {
      if (payment.net <= 0 && payment.state !== 'succeeded') continue;
      addMoney(paid, payment.currency, payment.net);
      if (!last || payment.date.getTime() > last.date.getTime()) last = payment;
    }

    const balance = new Map<string, number>();
    for (const invoice of overdue) {
      addMoney(
        balance,
        invoice.currency,
        Math.max(0, Number(invoice.total) - Number(invoice.amount_paid)),
      );
    }

    const monthly = new Map<string, number>();
    let nextRenewal: Date | null = null;
    for (const sub of subscriptions) {
      if (!(BILLABLE_STATES as readonly string[]).includes(sub.state)) continue;
      const months = CYCLE_MONTHS[sub.plan?.billing_cycle ?? 'monthly'] ?? null;
      if (months) addMoney(monthly, sub.currency, Number(sub.effective_price) / months);
      const renewal = sub.next_billing_at ?? sub.current_period_end;
      if (renewal && (!nextRenewal || renewal.getTime() < nextRenewal.getTime())) {
        nextRenewal = renewal;
      }
    }

    return {
      total_paid: moneyList(paid),
      last_payment: last
        ? {
            date: last.date,
            amount: round2(last.net),
            currency: last.currency,
            store_id: last.store_id,
          }
        : null,
      next_renewal_at: nextRenewal,
      overdue_count: overdue.length,
      overdue_balance: moneyList(balance),
      monthly_value: moneyList(monthly),
    };
  }

  private emptyMetrics(): SubscriptionMetrics {
    return this.computeMetrics([], [], []);
  }

  private storeView(
    store: PlatformCoveredStore,
    subscription: { state: string; plan: { name: string } | null } | undefined,
  ): CoveredStoreView {
    return {
      store_id: store.store_id,
      store_name: store.store_name,
      organization_name: store.organization_name,
      plan_name: subscription?.plan?.name ?? null,
      subscription_state: subscription?.state ?? null,
    };
  }
}
