import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange } from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
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

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  /**
   * Order states that count as REVENUE for the period. Includes 'refunded' so
   * that an order created and refunded in the same period nets to zero instead
   * of producing a phantom negative on net_profit (the refund subtotal is
   * still subtracted below). Cross-period refunds are recognized in the period
   * they occur (standard returns accounting). Keep in sync with the COGS raw
   * SQL filter below.
   */
  private readonly REVENUE_STATES = ['delivered', 'finished', 'refunded'];

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
   * SINGLE rounding policy for every numeric value this service emits (amounts,
   * percentages, rates): round-half-away-from-zero to 2 decimals. The
   * `Number.EPSILON` nudge cancels binary-float artifacts (e.g. avoids
   * `1234.5600000000003`), and the explicit sign handling keeps it symmetric for
   * negative money (net_profit, cash difference) instead of `Math.round`'s
   * toward-`+∞` bias.
   */
  private round2(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const sign = value < 0 ? -1 : 1;
    return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  }

  async getTaxSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    // Aggregate tax from order_item_taxes via order_items -> orders
    const orderItems = await this.prisma.order_items.findMany({
      where: {
        orders: {
          state: { in: this.REVENUE_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      select: {
        id: true,
        total_price: true,
        tax_amount_item: true,
        order_item_taxes: {
          select: {
            tax_name: true,
            tax_rate: true,
            tax_amount: true,
            tax_type: true,
            is_compound: true,
          },
        },
      },
    });

    // Aggregate by tax_name
    const taxBreakdown = new Map<
      string,
      {
        tax_name: string;
        tax_type: string;
        tax_rate: number;
        total_tax: number;
        taxable_amount: number;
        is_compound: boolean;
      }
    >();

    let totalTaxableRevenue = 0;

    for (const item of orderItems) {
      const itemTotal = Number(item.total_price || 0);
      totalTaxableRevenue += itemTotal;

      for (const tax of item.order_item_taxes) {
        const taxName = tax.tax_name;
        const existing = taxBreakdown.get(taxName) || {
          tax_name: taxName,
          tax_type: tax.tax_type ?? 'iva',
          tax_rate: Number(tax.tax_rate || 0),
          total_tax: 0,
          taxable_amount: 0,
          is_compound: tax.is_compound || false,
        };
        existing.total_tax += Number(tax.tax_amount || 0);
        existing.taxable_amount += itemTotal;
        taxBreakdown.set(taxName, existing);
      }
    }

    // Get tax refunds
    const taxRefunds = await this.prisma.refunds.aggregate({
      where: {
        state: { in: ['completed', 'approved'] },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        tax_refund: true,
      },
    });
    const totalTaxRefunded = this.round2(Number(taxRefunds._sum.tax_refund || 0));

    // DATA-CELL-2: round each breakdown row FIRST, then derive the collected
    // total from the SUM of those rounded rows. Previously the total accumulated
    // the raw item-level `tax_amount_item` (unrounded) while the breakdown rows
    // were rounded, so the export's TOTAL row could differ from the sum of its
    // detail rows by cents. Deriving the total from the rounded breakdown
    // guarantees the reconciliation invariant
    // `sum(breakdown[].total_tax) === total_tax_collected`.
    const breakdown = Array.from(taxBreakdown.values()).map((b) => ({
      tax_name: b.tax_name,
      tax_type: b.tax_type,
      tax_rate: this.round2(b.tax_rate),
      total_tax: this.round2(b.total_tax),
      taxable_amount: this.round2(b.taxable_amount),
      is_compound: b.is_compound,
    }));
    const totalTaxCollected = this.round2(
      breakdown.reduce((sum, b) => sum + b.total_tax, 0),
    );
    const totalTaxableRevenueRounded = this.round2(totalTaxableRevenue);

    return {
      total_tax_collected: totalTaxCollected,
      total_tax_refunded: totalTaxRefunded,
      net_tax: this.round2(totalTaxCollected - totalTaxRefunded),
      total_taxable_revenue: totalTaxableRevenueRounded,
      effective_tax_rate:
        totalTaxableRevenueRounded > 0
          ? this.round2((totalTaxCollected / totalTaxableRevenueRounded) * 100)
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
    const cacheKey = `analytics:financial:profit-loss:${storeId}:${query.date_preset ?? '_'}:${query.date_from ?? '_'}:${query.date_to ?? '_'}`;
    const cached =
      await this.cache.get<
        Awaited<ReturnType<FinancialAnalyticsService['computeProfitLossSummary']>>
      >(cacheKey);
    if (cached) return cached;

    const result = await this.computeProfitLossSummary(query, storeId);
    await this.cache.set(cacheKey, result, PROFIT_LOSS_CACHE_TTL_MS);
    return result;
  }

  private async computeProfitLossSummary(
    query: AnalyticsQueryDto,
    storeId: number,
  ) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const [
      orderAggregates,
      cogsRows,
      refundAggregates,
      expenseAggregates,
    ] = await Promise.all([
      this.prisma.orders.aggregate({
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
      }),
      // COGS = SUM(cost_price * quantity) per line item.
      // Must be computed in SQL: SUM(a)*SUM(b) != SUM(a*b).
      // withoutScope() needed: $queryRaw is not available on the scoped client.
      // storeId is validated above and used in the WHERE clause.
      (this.prisma.withoutScope() as any).$queryRaw<Array<{ cogs: any }>>`
        SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cogs
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.store_id = ${storeId}
          AND o.state IN ('delivered', 'finished', 'refunded') -- keep in sync with REVENUE_STATES
          AND o.created_at >= ${startDate}
          AND o.created_at <= ${endDate}
      `,
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
      this.prisma.expenses.aggregate({
        where: {
          state: 'paid',
          expense_date: { gte: startDate, lte: endDate },
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const revenue = Number(orderAggregates._sum.subtotal_amount || 0);
    const discounts = Number(orderAggregates._sum.discount_amount || 0);
    const netRevenue = revenue - discounts;
    const totalCOGS = Number(cogsRows[0]?.cogs ?? 0);
    const grossProfit = netRevenue - totalCOGS;
    const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const taxCollected = Number(orderAggregates._sum.tax_amount || 0);
    const shippingRevenue = Number(orderAggregates._sum.shipping_cost || 0);
    const refundAmount = Number(refundAggregates._sum.amount || 0);
    const refundSubtotal = Number(refundAggregates._sum.subtotal_refund || 0);
    const refundTax = Number(refundAggregates._sum.tax_refund || 0);
    const refundShipping = Number(refundAggregates._sum.shipping_refund || 0);
    const operatingExpenses = Number(expenseAggregates._sum.amount || 0);
    const netProfit =
      grossProfit + shippingRevenue - refundSubtotal - operatingExpenses;
    const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

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
        tax_collected: this.round2(taxCollected),
      },
      costs: {
        cost_of_goods_sold: this.round2(totalCOGS),
        gross_profit: this.round2(grossProfit),
        gross_margin: this.round2(grossMargin),
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
    };
  }

  async getRefundsSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const refundAggregates = await this.prisma.refunds.aggregate({
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
    });

    return {
      total_refunds: Number(refundAggregates._sum.amount || 0),
      subtotal_refunds: Number(refundAggregates._sum.subtotal_refund || 0),
      tax_refunds: Number(refundAggregates._sum.tax_refund || 0),
      shipping_refunds: Number(refundAggregates._sum.shipping_refund || 0),
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
      money('revenue', 'tax_collected', taxSummary.total_tax_collected),
      // Costs
      money('costs', 'cost_of_goods_sold', profitLoss.costs.cost_of_goods_sold),
      money('costs', 'gross_profit', profitLoss.costs.gross_profit),
      percent('costs', 'gross_margin', profitLoss.costs.gross_margin),
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
