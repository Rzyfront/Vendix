import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  localPeriodSql,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import {
  formatPeriodFromDate,
  getPreviousPeriod,
  parseDateRange,
} from '../utils/date.util';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import { Granularity } from '../dto/analytics-query.dto';
import { PaymentsAnalyticsQueryDto } from '../dto/payments-analytics-query.dto';
import {
  CASH_INCOME_PAYMENT_STATES,
  REFUND_CASH_OUT_STATES,
  computeGrowth,
  round2,
  sqlStateList,
} from '../analytics-metrics.contract';

/** Tope documentado del dataset de export (skill vendix-report-xlsx, regla 4). */
export const PAYMENTS_EXPORT_LIMIT = 10000;

export interface PaymentsReportRow {
  id: number;
  effective_date: string;
  paid_at: string | null;
  created_at: string | null;
  state: string;
  amount: number;
  refunded_amount: number;
  net_amount: number;
  currency: string | null;
  transaction_id: string | null;
  gateway_reference: string | null;
  order: {
    id: number;
    order_number: string;
    state: string;
    channel: string | null;
  };
  customer: {
    id: number | null;
    name: string;
    document: string | null;
    email: string | null;
  } | null;
  payment_method: {
    id: number | null;
    display_name: string;
    type: string | null;
  } | null;
  bank_account: { id: number; name: string } | null;
  cash_register: { session_id: number; register_name: string | null } | null;
  has_receipt: boolean;
}

export interface PaymentsSummary {
  total_collected: number;
  collected_count: number;
  total_amount: number;
  payments_count: number;
  average_payment: number;
  total_refunded: number;
  net_collected: number;
  pending_amount: number;
  failed_count: number;
  previous_total_collected: number;
  collected_growth: number | null;
  by_method: Array<{
    payment_method_id: number | null;
    display_name: string;
    type: string | null;
    count: number;
    collected_amount: number;
    percentage: number;
  }>;
  by_state: Array<{ state: string; count: number; amount: number }>;
}

export interface PaymentsTrendPoint {
  period: string;
  collected_amount: number;
  payments_count: number;
}

/** Pagos aún no cobrados (intención o reserva): "pendiente de cobro". */
const PENDING_PAYMENT_STATES = ['pending', 'authorized'] as const;

/** Etiqueta de método cuando el pago no tiene método asociado. */
const NO_METHOD_LABEL = 'Sin método';

/** Columnas de orden permitidas -> expresión SQL (lista blanca, nunca input). */
const SORT_SQL: Record<string, string> = {
  effective_date: 'COALESCE(p.paid_at, p.created_at)',
  amount: 'p.amount',
  state: 'p.state::text',
};

const toNum = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const toIso = (v: unknown): string | null =>
  v ? (v instanceof Date ? v : new Date(v as string)).toISOString() : null;

/**
 * Reporte y analítica de pagos (solo lectura).
 *
 * Alcance: `payments` no tiene `store_id`; el scope va por `orders.store_id`,
 * que se fija explícito en TODO el SQL crudo (`$queryRaw` no pasa por el
 * cliente con scope). Fecha efectiva = `COALESCE(paid_at, created_at)` (INSTANTE
 * en TZ de tienda vía `parseDateRange`): el 64 % de los `succeeded` en prod no
 * tiene `paid_at`. "Recaudado" = `CASH_INCOME_PAYMENT_STATES`; reembolsado =
 * refunds en `REFUND_CASH_OUT_STATES`; neto = monto − reembolsado.
 */
@Injectable()
export class PaymentsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ==================== HELPERS ====================

  private getStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  /** `$queryRaw` no existe en el cliente con scope; el store_id va explícito. */
  private get raw(): any {
    return this.prisma.withoutScope() as any;
  }

  /** WHERE común: store + rango efectivo + filtros (state, método, búsqueda). */
  private buildWhere(
    storeId: number,
    startDate: Date,
    endDate: Date,
    query: PaymentsAnalyticsQueryDto,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o.store_id = ${storeId}`,
      Prisma.sql`COALESCE(p.paid_at, p.created_at) >= ${startDate}`,
      Prisma.sql`COALESCE(p.paid_at, p.created_at) <= ${endDate}`,
    ];

    if (query.state?.length) {
      conditions.push(
        Prisma.sql`p.state IN (${Prisma.join(
          query.state.map((s) => Prisma.sql`${s}::payments_state_enum`),
        )})`,
      );
    }

    if (query.payment_method_id?.length) {
      conditions.push(
        Prisma.sql`p.store_payment_method_id IN (${Prisma.join(
          query.payment_method_id,
        )})`,
      );
    }

    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(Prisma.sql`(
        o.order_number ILIKE ${like}
        OR p.transaction_id ILIKE ${like}
        OR p.gateway_reference ILIKE ${like}
        OR u.first_name ILIKE ${like}
        OR u.last_name ILIKE ${like}
        OR (u.first_name || ' ' || u.last_name) ILIKE ${like}
        OR u.email ILIKE ${like}
        OR u.document_number ILIKE ${like}
        OR o.customer_alias ILIKE ${like}
      )`);
    }

    return Prisma.join(conditions, ' AND ');
  }

  /** Joins compartidos por lista, resumen y tendencias (el cliente se necesita para `search`). */
  private static readonly BASE_JOINS = Prisma.sql`
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN users u ON u.id = o.customer_id
    LEFT JOIN store_payment_methods spm ON spm.id = p.store_payment_method_id
    LEFT JOIN system_payment_methods sys ON sys.id = spm.system_payment_method_id
  `;

  private async resolveRange(
    storeId: number,
    query: PaymentsAnalyticsQueryDto,
  ): Promise<{ tz: string; startDate: Date; endDate: Date }> {
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);
    return { tz, startDate, endDate };
  }

  // ==================== LIST ====================

  async getPayments(
    query: PaymentsAnalyticsQueryDto,
  ): Promise<{
    data: PaymentsReportRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const storeId = this.getStoreId();
    const { startDate, endDate } = await this.resolveRange(storeId, query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 10));
    const where = this.buildWhere(storeId, startDate, endDate, query);

    const [countRows, rows] = await Promise.all([
      this.raw.$queryRaw`
        SELECT COUNT(*) AS total
        ${PaymentsAnalyticsService.BASE_JOINS}
        WHERE ${where}
      `,
      this.queryRows(storeId, where, query, limit, (page - 1) * limit),
    ]);

    return {
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  /** Dataset completo para el XLSX (tope {@link PAYMENTS_EXPORT_LIMIT}). */
  async getPaymentsForExport(
    query: PaymentsAnalyticsQueryDto,
  ): Promise<PaymentsReportRow[]> {
    const storeId = this.getStoreId();
    const { startDate, endDate } = await this.resolveRange(storeId, query);
    const where = this.buildWhere(storeId, startDate, endDate, query);
    return this.queryRows(storeId, where, query, PAYMENTS_EXPORT_LIMIT, 0);
  }

  private async queryRows(
    storeId: number,
    where: Prisma.Sql,
    query: PaymentsAnalyticsQueryDto,
    limit: number,
    offset: number,
  ): Promise<PaymentsReportRow[]> {
    const sortExpr = SORT_SQL[query.sort_by ?? 'effective_date'] ?? SORT_SQL.effective_date;
    const direction = query.sort_order === 'asc' ? 'ASC' : 'DESC';
    const orderBy = Prisma.raw(`${sortExpr} ${direction}, p.id ${direction}`);
    const refundStates = sqlStateList([...REFUND_CASH_OUT_STATES]);

    const rows: any[] = await this.raw.$queryRaw`
      SELECT
        p.id,
        COALESCE(p.paid_at, p.created_at) AS effective_at,
        p.paid_at,
        p.created_at,
        p.state::text AS state,
        p.amount,
        COALESCE(rf.refunded, 0) AS refunded_amount,
        p.currency,
        p.transaction_id,
        p.gateway_reference,
        (p.receipt_s3_key IS NOT NULL) AS has_receipt,
        o.id AS order_id,
        o.order_number,
        o.state::text AS order_state,
        o.channel::text AS order_channel,
        o.customer_alias,
        u.id AS customer_id,
        u.first_name AS customer_first_name,
        u.last_name AS customer_last_name,
        u.document_number AS customer_document,
        u.email AS customer_email,
        spm.id AS method_id,
        COALESCE(NULLIF(BTRIM(spm.display_name), ''), sys.display_name, sys.name) AS method_name,
        sys.type::text AS method_type,
        ba.id AS bank_account_id,
        ba.name AS bank_account_name,
        crm.session_id AS cash_session_id,
        cr.name AS cash_register_name
      ${PaymentsAnalyticsService.BASE_JOINS}
      LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
      LEFT JOIN LATERAL (
        SELECT SUM(r.amount) AS refunded
        FROM refunds r
        WHERE r.payment_id = p.id AND r.state IN (${refundStates})
      ) rf ON TRUE
      LEFT JOIN LATERAL (
        SELECT m.session_id
        FROM cash_register_movements m
        WHERE m.payment_id = p.id AND m.store_id = ${storeId}
        ORDER BY m.id ASC
        LIMIT 1
      ) crm ON TRUE
      LEFT JOIN cash_register_sessions crs ON crs.id = crm.session_id
      LEFT JOIN cash_registers cr ON cr.id = crs.cash_register_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((r) => {
      const amount = toNum(r.amount);
      const refunded = toNum(r.refunded_amount);
      const fullName = [r.customer_first_name, r.customer_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      const customer =
        r.customer_id !== null && r.customer_id !== undefined
          ? {
              id: Number(r.customer_id),
              name: fullName,
              document: r.customer_document ?? null,
              email: r.customer_email ?? null,
            }
          : r.customer_alias
            ? {
                id: null,
                name: String(r.customer_alias),
                document: null,
                email: null,
              }
            : null;
      return {
        id: Number(r.id),
        effective_date: toIso(r.effective_at) as string,
        paid_at: toIso(r.paid_at),
        created_at: toIso(r.created_at),
        state: r.state,
        amount: round2(amount),
        refunded_amount: round2(refunded),
        net_amount: round2(amount - refunded),
        currency: r.currency ?? null,
        transaction_id: r.transaction_id ?? null,
        gateway_reference: r.gateway_reference ?? null,
        order: {
          id: Number(r.order_id),
          order_number: r.order_number,
          state: r.order_state,
          channel: r.order_channel ?? null,
        },
        customer,
        payment_method:
          r.method_id !== null && r.method_id !== undefined
            ? {
                id: Number(r.method_id),
                display_name: r.method_name ?? NO_METHOD_LABEL,
                type: r.method_type ?? null,
              }
            : null,
        bank_account:
          r.bank_account_id !== null && r.bank_account_id !== undefined
            ? { id: Number(r.bank_account_id), name: r.bank_account_name }
            : null,
        cash_register:
          r.cash_session_id !== null && r.cash_session_id !== undefined
            ? {
                session_id: Number(r.cash_session_id),
                register_name: r.cash_register_name ?? null,
              }
            : null,
        has_receipt: !!r.has_receipt,
      };
    });
  }

  // ==================== SUMMARY ====================

  async getSummary(query: PaymentsAnalyticsQueryDto): Promise<PaymentsSummary> {
    const storeId = this.getStoreId();
    const { startDate, endDate } = await this.resolveRange(storeId, query);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );
    const where = this.buildWhere(storeId, startDate, endDate, query);
    const previousWhere = this.buildWhere(
      storeId,
      previousStartDate,
      previousEndDate,
      query,
    );
    const collected = sqlStateList([...CASH_INCOME_PAYMENT_STATES]);
    const refundStates = sqlStateList([...REFUND_CASH_OUT_STATES]);
    const pending = sqlStateList([...PENDING_PAYMENT_STATES]);

    const [totalsRows, previousRows, methodRows, stateRows] = await Promise.all([
      this.raw.$queryRaw`
        SELECT
          COALESCE(SUM(p.amount) FILTER (WHERE p.state IN (${collected})), 0) AS total_collected,
          COUNT(*) FILTER (WHERE p.state IN (${collected})) AS collected_count,
          COALESCE(SUM(p.amount), 0) AS total_amount,
          COUNT(*) AS payments_count,
          COALESCE(SUM(p.amount) FILTER (WHERE p.state IN (${pending})), 0) AS pending_amount,
          COUNT(*) FILTER (WHERE p.state = 'failed') AS failed_count,
          COALESCE(SUM(rf.refunded), 0) AS total_refunded
        ${PaymentsAnalyticsService.BASE_JOINS}
        LEFT JOIN LATERAL (
          SELECT SUM(r.amount) AS refunded
          FROM refunds r
          WHERE r.payment_id = p.id AND r.state IN (${refundStates})
        ) rf ON TRUE
        WHERE ${where}
      `,
      this.raw.$queryRaw`
        SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.state IN (${collected})), 0) AS total_collected
        ${PaymentsAnalyticsService.BASE_JOINS}
        WHERE ${previousWhere}
      `,
      this.raw.$queryRaw`
        SELECT
          spm.id AS method_id,
          COALESCE(NULLIF(BTRIM(spm.display_name), ''), sys.display_name, sys.name) AS method_name,
          sys.type::text AS method_type,
          COUNT(*) FILTER (WHERE p.state IN (${collected})) AS collected_count,
          COALESCE(SUM(p.amount) FILTER (WHERE p.state IN (${collected})), 0) AS collected_amount
        ${PaymentsAnalyticsService.BASE_JOINS}
        WHERE ${where}
        GROUP BY spm.id, 2, 3
        ORDER BY collected_amount DESC, spm.id ASC
      `,
      this.raw.$queryRaw`
        SELECT p.state::text AS state, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount
        ${PaymentsAnalyticsService.BASE_JOINS}
        WHERE ${where}
        GROUP BY p.state
        ORDER BY amount DESC, state ASC
      `,
    ]);

    const t = totalsRows[0] ?? {};
    const totalCollected = toNum(t.total_collected);
    const collectedCount = Number(t.collected_count ?? 0);
    const totalRefunded = toNum(t.total_refunded);
    const previousCollected = toNum(previousRows[0]?.total_collected);

    return {
      total_collected: round2(totalCollected),
      collected_count: collectedCount,
      total_amount: round2(toNum(t.total_amount)),
      payments_count: Number(t.payments_count ?? 0),
      average_payment:
        collectedCount > 0 ? round2(totalCollected / collectedCount) : 0,
      total_refunded: round2(totalRefunded),
      net_collected: round2(totalCollected - totalRefunded),
      pending_amount: round2(toNum(t.pending_amount)),
      failed_count: Number(t.failed_count ?? 0),
      previous_total_collected: round2(previousCollected),
      collected_growth: (() => {
        const g = computeGrowth(totalCollected, previousCollected);
        return g === null ? null : round2(g);
      })(),
      by_method: (methodRows as any[]).map((m) => {
        const amount = toNum(m.collected_amount);
        return {
          payment_method_id:
            m.method_id === null || m.method_id === undefined
              ? null
              : Number(m.method_id),
          display_name: m.method_name ?? NO_METHOD_LABEL,
          type: m.method_type ?? null,
          count: Number(m.collected_count ?? 0),
          collected_amount: round2(amount),
          percentage:
            totalCollected > 0 ? round2((amount / totalCollected) * 100) : 0,
        };
      }),
      by_state: (stateRows as any[]).map((s) => ({
        state: s.state,
        count: Number(s.count ?? 0),
        amount: round2(toNum(s.amount)),
      })),
    };
  }

  // ==================== TRENDS ====================

  async getTrends(
    query: PaymentsAnalyticsQueryDto,
  ): Promise<PaymentsTrendPoint[]> {
    const storeId = this.getStoreId();
    const { tz, startDate, endDate } = await this.resolveRange(storeId, query);
    const granularity = query.granularity || Granularity.DAY;
    const where = this.buildWhere(storeId, startDate, endDate, query);
    const collected = sqlStateList([...CASH_INCOME_PAYMENT_STATES]);
    // Bucket en el calendario LOCAL de la tienda (label TEXT autoritativo).
    const periodSql = localPeriodSql(
      'COALESCE(p.paid_at, p.created_at)',
      tz,
      granularity,
    );

    const rows: any[] = await this.raw.$queryRaw`
      SELECT
        ${periodSql} AS period,
        COALESCE(SUM(p.amount) FILTER (WHERE p.state IN (${collected})), 0) AS collected_amount,
        COUNT(*) FILTER (WHERE p.state IN (${collected})) AS payments_count
      ${PaymentsAnalyticsService.BASE_JOINS}
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const series: PaymentsTrendPoint[] = rows.map((r) => ({
      period: r.period,
      collected_amount: round2(toNum(r.collected_amount)),
      payments_count: Number(r.payments_count ?? 0),
    }));

    return fillTimeSeries(
      series,
      startDate,
      endDate,
      granularity,
      { collected_amount: 0, payments_count: 0 },
      formatPeriodFromDate,
      tz,
    );
  }
}
