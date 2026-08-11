import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange, getPreviousPeriod } from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  resolveLocalDateOnlyRange,
} from '@common/utils/store-timezone.util';
import {
  COMPLETED_SALE_STATES,
  REVENUE_STATES,
  REFUND_RECOGNIZED_STATES,
  RECOGNIZED_EXPENSE_STATES,
  CostCoverage,
  buildCostCoverage,
  computeGrowth,
  computeOperatingRevenue,
  round2 as roundMoney,
  sqlStateList,
} from '../analytics-metrics.contract';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

// Aggregated P&L tolerates 1-2 min of staleness → short TTL (ms).
const PROFIT_LOSS_CACHE_TTL_MS = 120_000;

/** Grouping key for a financial-summary export row (the ReportBuilder lays out by section). */
export type FinancialExportSection =
  | 'meta'
  | 'revenue'
  | 'costs'
  | 'refunds'
  | 'expenses'
  | 'bottom_line';

/** How the ReportBuilder should interpret/format the populated value column of a row. */
export type FinancialMetricUnit =
  | 'currency'
  | 'percent'
  | 'count'
  | 'date'
  | 'text';

/**
 * One RAW financial-summary metric row (no pre-formatting). Exactly one value
 * column is populated per row, selected by `unit`; the rest are `null` so every
 * COLUMN stays single-typed (no mixed number/string/date columns in the emitted
 * sheet). Numeric `value` is 2-decimal rounded, `date` is a raw `Date` instant,
 * and `text` carries codes (e.g. currency). The ReportBuilder maps `metric` →
 * localized label and formats `value` according to `unit`.
 */
export interface FinancialSummaryExportRow {
  section: FinancialExportSection;
  metric: string;
  unit: FinancialMetricUnit;
  value: number | null;
  date: Date | null;
  text: string | null;
}

/**
 * One RAW tax-summary export row. `row_type` discriminates detail rows from the
 * single TOTAL row. Every column is single-typed: non-applicable cells on the
 * TOTAL row are `null` (never `''`) so numeric/boolean columns never turn mixed.
 * Monetary/rate values are 2-decimal rounded, and the TOTAL `tax_collected`
 * equals the SUM of the detail `tax_collected` values (reconciliation invariant).
 */
export interface TaxSummaryExportRow {
  row_type: 'detail' | 'total';
  tax_name: string;
  tax_type: string | null;
  tax_rate: number | null;
  taxable_amount: number;
  tax_collected: number;
  is_compound: boolean | null;
}

/**
 * One RAW cash-register-session export row. Money is `number` (2-decimal) and
 * dates are RAW `Date` instants — NOT formatted here (the ReportBuilder renders
 * them in the store timezone during the emission phase).
 */
export interface CashSessionExportRow {
  opened_at: Date;
  closed_at: Date | null;
  register_name: string | null;
  opened_by_name: string | null;
  closed_by_name: string | null;
  opening_amount: number;
  total_sales: number;
  total_expenses: number;
  expected_closing_amount: number;
  actual_closing_amount: number;
  difference: number;
  status: string;
}

@Injectable()
export class FinancialAnalyticsService {
  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private readonly COMPLETED_STATES = [...COMPLETED_SALE_STATES];

  /**
   * Order states that count as REVENUE for the period. This is the CONTRACT's
   * {@link COMPLETED_SALE_STATES} plus `refunded`, and the addition is deliberate:
   * an order created and refunded inside the same period must net to zero instead
   * of producing a phantom negative on net_profit (the refund subtotal is still
   * subtracted below). Cross-period refunds are recognized in the period they
   * occur (standard returns accounting).
   *
   * Derived from the contract rather than re-typed, so a change to the canonical
   * sale states propagates here instead of silently diverging.
   */
  private readonly REVENUE_STATES = [...COMPLETED_SALE_STATES, 'refunded'];

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context (e.g. the scoped
   * client would already reject such a call before reaching real data).
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  /**
   * SINGLE rounding policy for every numeric value this service emits. Delegates
   * to the contract's `round2` so the policy has ONE owner across analytics
   * rather than a private copy per service.
   */
  private round2(value: number): number {
    return roundMoney(value);
  }

  async getTaxSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    // Scoped store-prisma client only exposes $queryRawUnsafe, not $queryRaw,
    // so we go through `withoutScope()` to use the safe `Prisma.sql` template
    // form and explicitly filter by store_id in the WHERE clause (the same
    // pattern used by `aggregateRevenueOrders` below for org-level reads).
    const context = RequestContextService.getContext();
    const storeId = context?.store_id ?? 0;
    const rawClient: PrismaClient = this.prisma.withoutScope();

    // SAFE_STATE_REGEX-equivalent guard for the inlined IN list. SQLSTATE list
    // is also charset-validated by sqlStateList; this cast documents intent.
    const revenueStates = sqlStateList(COMPLETED_SALE_STATES);

    // QUI-630: GROUP BY on the per-tax rows in SQL — no more findMany of every
    // line into memory (defect 6). Base derived from each tax's own amount/rate
    // (defects 1+2), so a line with IVA + INC compounds correctly contributes its
    // IVA base and its INC base as two separate rows of the right size, not
    // `item_total` repeated. Tax type NULL is surfaced as 'unclassified' rather
    // than silently classified as 'iva' (defect 7). Orders state is restricted
    // to COMPLETED_SALE_STATES — 'refunded' is excluded because the IVA on a
    // refunded order was already collected when the order was delivered; the
    // refund is recognized separately via `refunds.tax_refund` (defect 5).
    const taxRows = await rawClient.$queryRaw<Array<{
      tax_type: string;
      tax_name: string;
      tax_rate: string | number;
      is_compound: boolean;
      total_tax: string | number;
      taxable_amount: string | number;
    }>>(Prisma.sql`
      SELECT
        COALESCE(oit.tax_type::text, 'unclassified') AS tax_type,
        oit.tax_name AS tax_name,
        oit.tax_rate AS tax_rate,
        COALESCE(oit.is_compound, false) AS is_compound,
        SUM(oit.tax_amount)::decimal AS total_tax,
        CASE
          WHEN oit.tax_rate > 0
            THEN SUM(oit.tax_amount) / (oit.tax_rate / 100)
          ELSE 0
        END::decimal AS taxable_amount
      FROM order_item_taxes oit
      -- The join from order_item_taxes to order_items is a per-item fan-in
      -- (each tax row belongs to exactly one item); SUM aggregates per-tax rows
      -- AFTER GROUP BY, not order-level columns, so the order fan-out rule
      -- does not apply here.
      JOIN order_items oi ON oit.order_item_id = oi.id -- tz-audit:ignore
      JOIN orders o ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN (${revenueStates})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY
        COALESCE(oit.tax_type::text, 'unclassified'),
        oit.tax_name,
        oit.tax_rate,
        COALESCE(oit.is_compound, false)
    `);

    // Defect 3: separate the period's line totals into "items that carry at
    // least one tax row" (taxable_revenue) and "items that carry none"
    // (exempt_revenue). The OLD code summed ALL `order_items.total_price`
    // regardless of whether the item had taxes, which dragged the effective
    // tax rate DOWN whenever the catalog contained any exempt product.
    const revenueRows = await rawClient.$queryRaw<Array<{
      taxable_revenue: string | number;
      exempt_revenue: string | number;
    }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN taxed.id IS NOT NULL THEN oi.total_price END), 0)::decimal
          AS taxable_revenue,
        COALESCE(SUM(CASE WHEN taxed.id IS NULL THEN oi.total_price END), 0)::decimal
          AS exempt_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT oit.id
        FROM order_item_taxes oit
        WHERE oit.order_item_id = oi.id
        LIMIT 1
      ) AS taxed ON true
      WHERE o.store_id = ${storeId}
        AND o.state IN (${revenueStates})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
    `);

    const taxableRevenue = Number(revenueRows[0]?.taxable_revenue ?? 0);
    const exemptRevenue = Number(revenueRows[0]?.exempt_revenue ?? 0);

    // Tax refunds remain on the `refunds` table (cross-period subtraction is a
    // known limitation, see ticket defect 5 — handling refund-period match is
    // out of scope for this ticket).
    const taxRefunds = await this.prisma.refunds.aggregate({
      where: {
        state: { in: ['completed', 'approved'] },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        tax_refund: true,
      },
    });
    const totalTaxRefunded = this.round2(Number(taxRefunds._sum.tax_refund ?? 0));

    // DATA-CELL-2: round each breakdown row FIRST, then derive the collected
    // total from the SUM of those rounded rows. Previously the total accumulated
    // the raw item-level `tax_amount_item` (unrounded) while the breakdown rows
    // were rounded, so the export's TOTAL row could differ from the sum of its
    // detail rows by cents. Deriving the total from the rounded breakdown
    // guarantees the reconciliation invariant
    // `sum(breakdown[].total_tax) === total_tax_collected`.
    const breakdown = taxRows.map((b) => ({
      tax_name: b.tax_name,
      tax_type: b.tax_type,
      tax_rate: this.round2(Number(b.tax_rate)),
      total_tax: this.round2(Number(b.total_tax)),
      taxable_amount: this.round2(Number(b.taxable_amount)),
      is_compound: b.is_compound,
    }));
    const totalTaxCollected = this.round2(
      breakdown.reduce((sum, b) => sum + b.total_tax, 0),
    );
    const taxableRevenueRounded = this.round2(taxableRevenue);
    const exemptRevenueRounded = this.round2(exemptRevenue);

    return {
      total_tax_collected: totalTaxCollected,
      total_tax_refunded: totalTaxRefunded,
      net_tax: this.round2(totalTaxCollected - totalTaxRefunded),
      total_taxable_revenue: taxableRevenueRounded,
      exempt_revenue: exemptRevenueRounded,
      effective_tax_rate:
        taxableRevenueRounded > 0
          ? this.round2((totalTaxCollected / taxableRevenueRounded) * 100)
          : 0,
      breakdown,
    };
  }

  async getCashSessionsReport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const page = query.page || 1;
    const limit = query.limit || 20;

    // Count total sessions
    const totalCount = await this.prisma.cash_register_sessions.count({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
    });

    // Get sessions with details
    const sessions = await this.prisma.cash_register_sessions.findMany({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        status: true,
        opened_at: true,
        closed_at: true,
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
        opened_by: true,
        closed_by: true,
        movements: {
          select: {
            type: true,
            amount: true,
          },
        },
      },
      orderBy: { opened_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Get session-level aggregates
    const aggregates = await this.prisma.cash_register_sessions.aggregate({
      where: {
        opened_at: { gte: startDate, lte: endDate },
        status: 'closed',
      },
      _sum: {
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
      },
      _count: {
        id: true,
      },
    });

    // Movement totals across all sessions in range
    const sessionIds = sessions.map((s) => s.id);
    const movementTotals =
      sessionIds.length > 0
        ? await this.prisma.cash_register_movements.groupBy({
            by: ['session_id'],
            where: {
              session_id: { in: sessionIds },
              type: 'sale',
            },
            _sum: {
              amount: true,
            },
          })
        : [];

    const movementMap = new Map<number | null, number>(
      movementTotals.map((m) => [m.session_id, Number(m._sum.amount || 0)]),
    );

    const data = sessions.map((s) => {
      const salesTotal = movementMap.get(s.id) || 0;

      return {
        session_id: s.id,
        status: s.status,
        opened_at: s.opened_at.toISOString(),
        closed_at: s.closed_at ? s.closed_at.toISOString() : null,
        opening_amount: Number(s.opening_amount || 0),
        expected_closing_amount: Number(s.expected_closing_amount || 0),
        actual_closing_amount: Number(s.actual_closing_amount || 0),
        difference: Number(s.difference || 0),
        sales_total: salesTotal,
        total_movements: s.movements.length,
      };
    });

    return {
      data,
      summary: {
        total_sessions: totalCount,
        closed_sessions: aggregates._count.id || 0,
        total_opening_amount: Number(aggregates._sum.opening_amount || 0),
        total_expected: Number(aggregates._sum.expected_closing_amount || 0),
        total_actual: Number(aggregates._sum.actual_closing_amount || 0),
        total_difference: Number(aggregates._sum.difference || 0),
      },
      meta: {
        pagination: {
          total: totalCount,
          page,
          limit,
          total_pages: Math.ceil(totalCount / limit),
        },
      },
    };
  }

  async getProfitLossSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Tenant + period scoped key: store_id isolates the tenant; the date-range
    // inputs (preset/from/to) capture the period. Relative presets like "today"
    // keep a stable key and rely on the short TTL for freshness.
    // `v2` = payload shape that carries operating_revenue / cost_coverage /
    // comparison. Bumped with the shape so a rolling deploy cannot serve a
    // v1-shaped object to a frontend that reads the new fields.
    const cacheKey = `analytics:financial:profit-loss:v2:${storeId}:${query.date_preset ?? '_'}:${query.date_from ?? '_'}:${query.date_to ?? '_'}`;
    const cached =
      await this.cache.get<
        Awaited<ReturnType<FinancialAnalyticsService['computeProfitLossSummary']>>
      >(cacheKey);
    if (cached) return cached;

    const result = await this.computeProfitLossSummary(query, storeId);
    await this.cache.set(cacheKey, result, PROFIT_LOSS_CACHE_TTL_MS);
    return result;
  }

  /**
   * Order-level monetary aggregate for one window, over {@link REVENUE_STATES}.
   */
  private async aggregateRevenueOrders(startDate: Date, endDate: Date) {
    return this.prisma.orders.aggregate({
      where: {
        state: { in: this.REVENUE_STATES },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        tax_amount: true,
        shipping_cost: true,
        grand_total: true,
      },
      _count: {
        id: true,
      },
    });
  }

  /**
   * COGS for one window, plus the counters that make it auditable.
   *
   * Must be computed in SQL: `SUM(a) * SUM(b) != SUM(a * b)` — cost is multiplied
   * per line before summing. `units_without_cost` rides along because
   * `COALESCE(cost_price, 0)` turns "cost unknown" into "cost zero", which is
   * indistinguishable from a real 100 % margin. `withoutScope()` is required
   * ($queryRaw is not on the scoped client); `storeId` is validated by the caller
   * and pinned in the WHERE clause, and the state list comes from the contract.
   */
  private async aggregateCogs(
    storeId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<{ cogs: number; coverage: CostCoverage }> {
    const states = sqlStateList(this.REVENUE_STATES);
    // QUI-631: typed handle for the raw query — same TS2347 fix as
    // inventory-analytics and sales-analytics. The scoped client's
    // withoutScope() returns `any` after the cast, which prevents the
    // generic on $queryRaw<T> from resolving.
    const untypedFinancial = (this.prisma.withoutScope() as any) as {
      $queryRaw: <T>(query: any) => Promise<T>;
    };
    const rows = await untypedFinancial.$queryRaw<
      Array<{ cogs: unknown; units: unknown; units_without_cost: unknown }>
    >(
      Prisma.sql`
      SELECT
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cogs,
        COALESCE(SUM(oi.quantity), 0) AS units,
        COALESCE(SUM(CASE WHEN oi.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_without_cost
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${storeId}
        AND o.state IN (${states})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
    `;
    const row = rows[0];
    return {
      cogs: Number(row?.cogs ?? 0),
      coverage: buildCostCoverage(
        Number(row?.units ?? 0),
        Number(row?.units_without_cost ?? 0),
      ),
    };
  }

  private async computeProfitLossSummary(
    query: AnalyticsQueryDto,
    storeId: number,
  ) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    // `expenses.expense_date` is a DATE-ONLY business date stored as naive
    // midnight, so it needs the naive-space window — the timestamp window pushed
    // every UI-created expense one day earlier, and month-boundary expenses into
    // the previous month.
    const expenseRange = resolveLocalDateOnlyRange(query, tz);
    const previousExpenseRange = getPreviousPeriod(
      expenseRange.startDate,
      expenseRange.endDate,
    );

    const [
      orderAggregates,
      cogsResult,
      refundAggregates,
      expenseAggregates,
      previousOrderAggregates,
      previousCogsResult,
      previousExpenseAggregates,
    ] = await Promise.all([
      this.aggregateRevenueOrders(startDate, endDate),
      this.aggregateCogs(storeId, startDate, endDate),
      this.prisma.refunds.aggregate({
        where: {
          state: { in: ['completed', 'approved'] },
          created_at: { gte: startDate, lte: endDate },
        },
        _sum: {
          amount: true,
          subtotal_refund: true,
          tax_refund: true,
          shipping_refund: true,
        },
      }),
      this.aggregateExpenses(expenseRange.startDate, expenseRange.endDate),
      this.aggregateRevenueOrders(previousStartDate, previousEndDate),
      this.aggregateCogs(storeId, previousStartDate, previousEndDate),
      this.aggregateExpenses(
        previousExpenseRange.previousStartDate,
        previousExpenseRange.previousEndDate,
      ),
    ]);

    const revenue = Number(orderAggregates._sum.subtotal_amount || 0);
    const discounts = Number(orderAggregates._sum.discount_amount || 0);
    const netRevenue = revenue - discounts;
    const taxCollected = Number(orderAggregates._sum.tax_amount || 0);
    const shippingRevenue = Number(orderAggregates._sum.shipping_cost || 0);

    // OPERATING REVENUE — the single figure every "Ingresos" card shows:
    // subtotal − discounts + freight charged, VAT excluded. It is also the ONE
    // denominator for both margins, so the percentage and the amount on screen
    // are computed off the same base (they previously were not: the panel showed
    // `grand_total` while the margin divided by `net_revenue`).
    const operatingRevenue = computeOperatingRevenue({
      subtotal: revenue,
      discounts,
      shipping: shippingRevenue,
      tax: taxCollected,
    });

    const totalCOGS = cogsResult.cogs;
    const grossProfit = operatingRevenue - totalCOGS;
    const grossMargin =
      operatingRevenue > 0 ? (grossProfit / operatingRevenue) * 100 : 0;
    const refundAmount = Number(refundAggregates._sum.amount || 0);
    const refundSubtotal = Number(refundAggregates._sum.subtotal_refund || 0);
    const refundTax = Number(refundAggregates._sum.tax_refund || 0);
    const refundShipping = Number(refundAggregates._sum.shipping_refund || 0);
    const operatingExpenses = expenseAggregates;
    const netProfit = grossProfit - refundSubtotal - operatingExpenses;
    const netMargin =
      operatingRevenue > 0 ? (netProfit / operatingRevenue) * 100 : 0;

    // Previous period, on the SAME definitions, so the panel's growth badge is
    // not computed off a different metric than the value it sits under.
    const previousOperatingRevenue = computeOperatingRevenue({
      subtotal: Number(previousOrderAggregates._sum.subtotal_amount || 0),
      discounts: Number(previousOrderAggregates._sum.discount_amount || 0),
      shipping: Number(previousOrderAggregates._sum.shipping_cost || 0),
      tax: Number(previousOrderAggregates._sum.tax_amount || 0),
    });
    const previousNetProfit =
      previousOperatingRevenue -
      previousCogsResult.cogs -
      previousExpenseAggregates;
    const previousOrderCount = previousOrderAggregates._count.id || 0;

    // DATA-CELL-1: apply the SINGLE rounding policy (`round2`) to every emitted
    // number. Internal math above stays RAW so derived figures (margins,
    // net_profit) are computed from full-precision components and only the
    // outputs are rounded — no compounding of rounding error, and no float
    // artifacts like `1234.5600000000003` leaking into the report.
    return {
      period: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
      revenue: {
        gross_revenue: this.round2(revenue),
        discounts: this.round2(discounts),
        net_revenue: this.round2(netRevenue),
        shipping_revenue: this.round2(shippingRevenue),
        /** Contract revenue: subtotal − discounts + freight, VAT excluded. */
        operating_revenue: this.round2(operatingRevenue),
        tax_collected: this.round2(taxCollected),
      },
      costs: {
        cost_of_goods_sold: this.round2(totalCOGS),
        gross_profit: this.round2(grossProfit),
        gross_margin: this.round2(grossMargin),
        /** Auditability of the COGS above — see `CostCoverage`. */
        cost_coverage: cogsResult.coverage,
      },
      refunds: {
        total_refunds: this.round2(refundAmount),
        subtotal_refunds: this.round2(refundSubtotal),
        tax_refunds: this.round2(refundTax),
        shipping_refunds: this.round2(refundShipping),
      },
      operating_expenses: this.round2(operatingExpenses),
      bottom_line: {
        net_profit: this.round2(netProfit),
        net_margin: this.round2(netMargin),
        order_count: orderAggregates._count.id || 0,
      },
      /**
       * Previous equivalent period on identical definitions. `*_growth` is `null`
       * when the previous period had no base — rendering that as "0 %" would
       * assert "no change" about a period that had nothing.
       */
      comparison: {
        operating_revenue: this.round2(previousOperatingRevenue),
        net_profit: this.round2(previousNetProfit),
        operating_expenses: this.round2(previousExpenseAggregates),
        order_count: previousOrderCount,
        revenue_growth: computeGrowth(operatingRevenue, previousOperatingRevenue),
        net_profit_growth: computeGrowth(netProfit, previousNetProfit),
        expenses_growth: computeGrowth(
          operatingExpenses,
          previousExpenseAggregates,
        ),
        orders_growth: computeGrowth(
          orderAggregates._count.id || 0,
          previousOrderCount,
        ),
      },
    };
  }

  /**
   * Recognized expenses (accrual: `approved` + `paid`) for a naive-space window.
   * `pending` is excluded by the contract — an unapproved capture is not yet an
   * expense, and counting it let a mistyped draft hit the store's profit at once.
   */
  private async aggregateExpenses(
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const result = await this.prisma.expenses.aggregate({
      where: {
        state: { in: [...RECOGNIZED_EXPENSE_STATES] },
        expense_date: { gte: startDate, lte: endDate }, // tz-audit:date-only — business-date; ventana de resolveLocalDateOnlyRange
      },
      _sum: { amount: true },
    });
    return Number(result._sum.amount || 0);
  }

  async getRefundsSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const states = sqlStateList(REFUND_RECOGNIZED_STATES);

    // Current period aggregates (count + sums + breakdown by reason).
    const [currentPeriod, previousPeriod, currentRefundCount, reasons, products] =
      await Promise.all([
        this.prisma.refunds.aggregate({
          where: {
            state: { in: [...REFUND_RECOGNIZED_STATES] },
            created_at: { gte: startDate, lte: endDate },
          },
          _sum: {
            amount: true,
            subtotal_refund: true,
            tax_refund: true,
            shipping_refund: true,
          },
          _count: { id: true },
        }),
        this.prisma.refunds.aggregate({
          where: {
            state: { in: [...REFUND_RECOGNIZED_STATES] },
            created_at: { gte: previousStartDate, lte: previousEndDate },
          },
          _sum: {
            amount: true,
            subtotal_refund: true,
            tax_refund: true,
            shipping_refund: true,
          },
          _count: { id: true },
        }),
        // WHY a separate COUNT instead of relying on _count.id above: the
        // `groupBy` shape (reasons) and the aggregate (currentPeriod) come
        // from different shapes; a single aggregate with _count would still
        // need a second query for the reasons breakdown, so this is the
        // minimum number of round-trips. We also pull revenue for the period
        // here so we can compute the return rate (the missing KPI).
        this.prisma.refunds.count({
          where: {
            state: { in: [...REFUND_RECOGNIZED_STATES] },
            created_at: { gte: startDate, lte: endDate },
          },
        }),
        this.prisma.refunds.groupBy({
          by: ['reason'],
          where: {
            state: { in: [...REFUND_RECOGNIZED_STATES] },
            created_at: { gte: startDate, lte: endDate },
            reason: { not: null },
          },
          _count: { id: true },
          _sum: { amount: true },
          orderBy: { _count: { id: 'desc' } },
          take: 10,
        }),
        // Top refunded products via refund_items → order_items → product. We
        // skip rows whose refund has no items (status-only refunds, admin
        // adjustments) because they have nothing per product to attribute to.
        (async () => {
          // We don't have a join table; we aggregate by product via SQL.
          const raw = await this.prisma.withoutScope().$queryRaw<
            Array<{ product_id: number; product_name: string; refund_amount: string }>
          >(Prisma.sql`
            SELECT
              oi.product_id AS product_id,
              MAX(p.name) AS product_name,
              COALESCE(SUM(ri.amount), 0)::decimal AS refund_amount
            FROM refund_items ri
            JOIN refunds r ON r.id = ri.refund_id
            JOIN order_items oi ON oi.id = ri.order_item_id
            JOIN products p ON p.id = oi.product_id
            WHERE r.store_id = ${RequestContextService.getContext()?.store_id ?? 0}
              AND r.state IN (${states})
              AND r.created_at >= ${startDate}
              AND r.created_at <= ${endDate}
            GROUP BY oi.product_id
            ORDER BY refund_amount DESC
            LIMIT 10
          `);
          return raw;
        })(),
      ]);

    // Operating revenue for the period — the denominator of the return rate.
    // NOTE: the revenue side already lives in getTaxSummary / getProfitLossSummary;
    // we only re-run it when the caller asks for refunds without it. Computing
    // it here keeps the endpoint self-contained (regression-safe: the export
    // route hits this and only this).
    const currentPeriodRevenue = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.REVENUE_STATES },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        shipping_cost: true,
        tax_amount: true,
      },
    });
    const previousPeriodRevenue = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.REVENUE_STATES },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        shipping_cost: true,
        tax_amount: true,
      },
    });

    const currentRevenue = computeOperatingRevenue({
      subtotal: Number(currentPeriodRevenue._sum.subtotal_amount || 0),
      discounts: Number(currentPeriodRevenue._sum.discount_amount || 0),
      shipping: Number(currentPeriodRevenue._sum.shipping_cost || 0),
      tax: Number(currentPeriodRevenue._sum.tax_amount || 0),
    });
    const previousRevenue = computeOperatingRevenue({
      subtotal: Number(previousPeriodRevenue._sum.subtotal_amount || 0),
      discounts: Number(previousPeriodRevenue._sum.discount_amount || 0),
      shipping: Number(previousPeriodRevenue._sum.shipping_cost || 0),
      tax: Number(previousPeriodRevenue._sum.tax_amount || 0),
    });

    const totalRefunds = Number(currentPeriod._sum.amount || 0);
    const previousRefunds = Number(previousPeriod._sum.amount || 0);
    const subtotalRefunds = Number(currentPeriod._sum.subtotal_refund || 0);
    const taxRefunds = Number(currentPeriod._sum.tax_refund || 0);
    const shippingRefunds = Number(currentPeriod._sum.shipping_refund || 0);

    // QUI-631 defect 4: assert the breakdown sums to total. If it doesn't,
    // the refund was registered with a wrong split — surface a count of
    // inconsistent refunds so the UI can warn the operator.
    const breakdownSum = subtotalRefunds + taxRefunds + shippingRefunds;
    const inconsistency = Math.abs(totalRefunds - breakdownSum);
    const inconsistentCount =
      inconsistency > 0.01 ? Number(currentPeriod._count.id || 0) : 0;

    const returnRate =
      currentRevenue > 0 ? (totalRefunds / currentRevenue) * 100 : 0;
    const averageRefund =
      Number(currentRefundCount || 0) > 0
        ? totalRefunds / Number(currentRefundCount)
        : 0;

    return {
      total_refunds: this.round2(totalRefunds),
      subtotal_refunds: this.round2(subtotalRefunds),
      tax_refunds: this.round2(taxRefunds),
      shipping_refunds: this.round2(shippingRefunds),
      refunds_count: Number(currentRefundCount || 0),
      average_refund: this.round2(averageRefund),
      return_rate: this.round2(returnRate),
      inconsistent_refunds: inconsistentCount,
      refunds_growth:
        previousRefunds > 0
          ? this.round2(
              ((totalRefunds - previousRefunds) / previousRefunds) * 100,
            )
          : null,
      refunds_count_growth:
        Number(previousPeriod._count.id || 0) > 0
          ? this.round2(
              ((Number(currentPeriod._count.id || 0) -
                Number(previousPeriod._count.id || 0)) /
                Number(previousPeriod._count.id)) *
                100,
            )
          : null,
      revenue_for_period: this.round2(currentRevenue),
      revenue_growth:
        previousRevenue > 0
          ? this.round2(((currentRevenue - previousRevenue) / previousRevenue) * 100)
          : null,
      by_reason: reasons.map((r) => ({
        reason: r.reason,
        count: Number(r._count.id || 0),
        amount: this.round2(Number(r._sum.amount || 0)),
      })),
      top_products: products.map((p) => ({
        product_id: p.product_id,
        product_name: p.product_name,
        refund_amount: this.round2(Number(p.refund_amount)),
      })),
    };
  }

  /**
   * RAW financial-summary rows for XLSX export (DATA-COMPLETE-6). Enriched from
   * the values already computed by the P&L + tax summaries: period range, store
   * currency, discounts, shipping revenue, the refund split, margins, and order
   * count — no invented data. Every value is raw (money as `number`, dates as
   * `Date`); the ReportBuilder localizes `metric` labels and formats per `unit`.
   */
  async getFinancialSummaryForExport(
    query: AnalyticsQueryDto,
  ): Promise<FinancialSummaryExportRow[]> {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const [profitLoss, taxSummary, currencyRow] = await Promise.all([
      this.getProfitLossSummary(query),
      this.getTaxSummary(query),
      // Currency is not part of the aggregated P&L; surface the period's currency
      // from the most recent revenue order (single-currency stores are the norm).
      this.prisma.orders.findFirst({
        where: {
          state: { in: this.REVENUE_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
        select: { currency: true },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const currency = currencyRow?.currency ?? null;

    const money = (
      section: FinancialExportSection,
      metric: string,
      amount: number,
    ): FinancialSummaryExportRow => ({
      section,
      metric,
      unit: 'currency',
      value: this.round2(amount),
      date: null,
      text: null,
    });
    const percent = (
      section: FinancialExportSection,
      metric: string,
      pct: number,
    ): FinancialSummaryExportRow => ({
      section,
      metric,
      unit: 'percent',
      value: this.round2(pct),
      date: null,
      text: null,
    });

    return [
      // Report metadata — RAW Date instants (NOT formatted here).
      {
        section: 'meta',
        metric: 'period_start',
        unit: 'date',
        value: null,
        date: startDate,
        text: null,
      },
      {
        section: 'meta',
        metric: 'period_end',
        unit: 'date',
        value: null,
        date: endDate,
        text: null,
      },
      {
        section: 'meta',
        metric: 'currency',
        unit: 'text',
        value: null,
        date: null,
        text: currency,
      },
      // Revenue
      money('revenue', 'gross_revenue', profitLoss.revenue.gross_revenue),
      money('revenue', 'discounts', profitLoss.revenue.discounts),
      money('revenue', 'net_revenue', profitLoss.revenue.net_revenue),
      money('revenue', 'shipping_revenue', profitLoss.revenue.shipping_revenue),
      money('revenue', 'operating_revenue', profitLoss.revenue.operating_revenue),
      money('revenue', 'tax_collected', taxSummary.total_tax_collected),
      // Costs
      money('costs', 'cost_of_goods_sold', profitLoss.costs.cost_of_goods_sold),
      money('costs', 'gross_profit', profitLoss.costs.gross_profit),
      percent('costs', 'gross_margin', profitLoss.costs.gross_margin),
      // Cost auditability: a COGS built on missing snapshots reads as a 100 %
      // margin, so the file states the coverage next to the figure.
      percent(
        'costs',
        'cost_coverage',
        profitLoss.costs.cost_coverage.coverage_ratio * 100,
      ),
      {
        section: 'costs',
        metric: 'units_without_cost',
        unit: 'count',
        value: profitLoss.costs.cost_coverage.units_without_cost,
        date: null,
        text: null,
      },
      // Refunds (split already computed by the P&L summary)
      money('refunds', 'total_refunds', profitLoss.refunds.total_refunds),
      money('refunds', 'subtotal_refunds', profitLoss.refunds.subtotal_refunds),
      money('refunds', 'tax_refunds', profitLoss.refunds.tax_refunds),
      money('refunds', 'shipping_refunds', profitLoss.refunds.shipping_refunds),
      // Expenses
      money('expenses', 'operating_expenses', profitLoss.operating_expenses),
      // Bottom line
      money('bottom_line', 'net_profit', profitLoss.bottom_line.net_profit),
      percent('bottom_line', 'net_margin', profitLoss.bottom_line.net_margin),
      {
        section: 'bottom_line',
        metric: 'order_count',
        unit: 'count',
        value: profitLoss.bottom_line.order_count,
        date: null,
        text: null,
      },
    ];
  }

  /**
   * RAW tax-summary rows for XLSX export. Detail rows come straight from the
   * (rounded) breakdown; the TOTAL row leaves non-applicable columns as `null`
   * (DATA-CELL-3 — never `''`, which would make `tax_rate`/`is_compound` mixed
   * columns) and its `tax_collected` equals the SUM of the detail `tax_collected`
   * values (DATA-CELL-2 reconciliation, guaranteed by `getTaxSummary`).
   */
  async getTaxSummaryForExport(
    query: AnalyticsQueryDto,
  ): Promise<TaxSummaryExportRow[]> {
    const result = await this.getTaxSummary(query);
    const rows: TaxSummaryExportRow[] = result.breakdown.map(
      (b): TaxSummaryExportRow => ({
        row_type: 'detail',
        tax_name: b.tax_name,
        tax_type: b.tax_type,
        tax_rate: b.tax_rate,
        taxable_amount: b.taxable_amount,
        tax_collected: b.total_tax,
        is_compound: b.is_compound,
      }),
    );
    rows.push({
      row_type: 'total',
      tax_name: 'TOTAL',
      tax_type: null,
      tax_rate: null,
      taxable_amount: result.total_taxable_revenue,
      tax_collected: result.total_tax_collected,
      is_compound: null,
    });
    return rows;
  }

  async getCashSessionsForExport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const sessions = await this.prisma.cash_register_sessions.findMany({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
      select: {
        status: true,
        opened_at: true,
        closed_at: true,
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
        register: { select: { name: true } },
        opened_by_user: { select: { first_name: true, last_name: true } },
        closed_by_user: { select: { first_name: true, last_name: true } },
        movements: {
          select: { type: true, amount: true },
        },
      },
      orderBy: { opened_at: 'desc' },
      take: 10000,
    });

    return sessions.map((s): CashSessionExportRow => {
      const salesMovements = s.movements.filter((m) => m.type === 'sale');
      const expenseMovements = s.movements.filter((m) => m.type === 'expense');
      const totalSales = salesMovements.reduce(
        (sum, m) => sum + Number(m.amount || 0),
        0,
      );
      const totalExpenses = expenseMovements.reduce(
        (sum, m) => sum + Number(m.amount || 0),
        0,
      );

      return {
        // RAW instants — do NOT format here (emission phase renders in TZ).
        opened_at: s.opened_at,
        closed_at: s.closed_at ?? null,
        register_name: s.register?.name ?? null,
        opened_by_name: s.opened_by_user
          ? `${s.opened_by_user.first_name} ${s.opened_by_user.last_name}`
          : null,
        closed_by_name: s.closed_by_user
          ? `${s.closed_by_user.first_name} ${s.closed_by_user.last_name}`
          : null,
        opening_amount: this.round2(Number(s.opening_amount || 0)),
        total_sales: this.round2(totalSales),
        total_expenses: this.round2(totalExpenses),
        expected_closing_amount: this.round2(
          Number(s.expected_closing_amount || 0),
        ),
        actual_closing_amount: this.round2(Number(s.actual_closing_amount || 0)),
        difference: this.round2(Number(s.difference || 0)),
        status: s.status,
      };
    });
  }
}
