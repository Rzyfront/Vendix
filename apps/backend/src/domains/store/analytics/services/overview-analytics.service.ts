import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto, Granularity } from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import {
  formatPeriodFromDate,
  parseDateRange,
  getPreviousPeriod,
} from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  resolveLocalDateOnlyRange,
  localPeriodSql,
  dateOnlyPeriodSql,
} from '@common/utils/store-timezone.util';
import {
  COMPLETED_SALE_STATES,
  RECOGNIZED_EXPENSE_STATES,
  CostCoverage,
  buildCostCoverage,
  computeGrowth,
  computeOperatingRevenue,
  round2,
  sqlStateList,
} from '../analytics-metrics.contract';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/** COGS + cost-coverage counters for one window, as returned by the raw query. */
interface CogsRow {
  cogs: unknown;
  units: unknown;
  units_without_cost: unknown;
}

@Injectable()
export class OverviewAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context (the scoped client
   * would already reject such a call before reaching real data).
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  /**
   * Order-level monetary aggregate for a window, restricted to consummated
   * sales. Returns the RAW components so the caller derives revenue through the
   * contract (never by reading `grand_total`, which carries VAT).
   */
  private async aggregateOrders(startDate: Date, endDate: Date) {
    return this.prisma.orders.aggregate({
      where: {
        state: { in: [...COMPLETED_SALE_STATES] },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        shipping_cost: true,
        tax_amount: true,
      },
    });
  }

  /**
   * COGS for a window, plus the counters that expose how much of it is real.
   *
   * Computed in SQL because `SUM(a) * SUM(b) != SUM(a * b)` — the cost must be
   * multiplied per line before summing. `units_without_cost` travels alongside so
   * a zero COGS caused by missing snapshots is never mistaken for a 100 % margin.
   * The item scan is bounded by the SAME store/state/window filter as the order
   * aggregate, so it cannot read another tenant's lines nor scan the whole table.
   */
  private async aggregateCogs(
    storeId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<{ cogs: number; coverage: CostCoverage }> {
    const states = sqlStateList(COMPLETED_SALE_STATES);
    const rows = await (this.prisma.withoutScope() as any).$queryRaw<CogsRow[]>`
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

  /**
   * Recognized expenses for a window. The window comes from
   * `resolveLocalDateOnlyRange` because `expenses.expense_date` is a DATE-ONLY
   * business date stored as naive midnight: feeding it the timestamp window
   * pushed every UI-created expense one day earlier (and month-boundary expenses
   * into the previous month).
   */
  private async aggregateExpenses(startDate: Date, endDate: Date) {
    const result = await this.prisma.expenses.aggregate({
      where: {
        state: { in: [...RECOGNIZED_EXPENSE_STATES] },
        expense_date: { gte: startDate, lte: endDate }, // tz-audit:date-only — business-date; ventana de resolveLocalDateOnlyRange
      },
      _sum: { amount: true },
    });
    return Number(result._sum.amount || 0);
  }

  async getOverviewSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const tz = await this.getStoreTimezone();

    // TWO windows, deliberately: timestamp columns (orders) align to the store's
    // local clock; the date-only expense column lives in naive space. Using one
    // for both is the off-by-one bug.
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );
    const expenseRange = resolveLocalDateOnlyRange(query, tz);
    const previousExpenseRange = getPreviousPeriod(
      expenseRange.startDate,
      expenseRange.endDate,
    );

    const [
      currentOrders,
      currentCogs,
      currentExpenses,
      previousOrders,
      previousCogs,
      previousExpenses,
    ] = await Promise.all([
      this.aggregateOrders(startDate, endDate),
      this.aggregateCogs(storeId, startDate, endDate),
      this.aggregateExpenses(expenseRange.startDate, expenseRange.endDate),
      this.aggregateOrders(previousStartDate, previousEndDate),
      this.aggregateCogs(storeId, previousStartDate, previousEndDate),
      this.aggregateExpenses(
        previousExpenseRange.previousStartDate,
        previousExpenseRange.previousEndDate,
      ),
    ]);

    // Operating revenue = subtotal − discounts + freight charged. VAT excluded:
    // it is reported separately as `total_taxes`, never as income.
    const totalIncome = computeOperatingRevenue({
      subtotal: Number(currentOrders._sum.subtotal_amount || 0),
      discounts: Number(currentOrders._sum.discount_amount || 0),
      shipping: Number(currentOrders._sum.shipping_cost || 0),
      tax: Number(currentOrders._sum.tax_amount || 0),
    });
    const totalTaxes = Number(currentOrders._sum.tax_amount || 0);
    const totalCogs = currentCogs.cogs;

    // The full chain, in order: revenue → gross (after cost of goods) → net
    // (after operating expenses). Skipping COGS here is what made "Ganancia Neta"
    // report the whole sale as profit.
    const grossProfit = totalIncome - totalCogs;
    const netProfit = grossProfit - currentExpenses;
    const grossMargin = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0;
    const netMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    // Break-even measures ALL costs against revenue, not just the expense ledger.
    const breakevenRatio =
      totalIncome > 0 ? ((totalCogs + currentExpenses) / totalIncome) * 100 : 0;

    const prevIncome = computeOperatingRevenue({
      subtotal: Number(previousOrders._sum.subtotal_amount || 0),
      discounts: Number(previousOrders._sum.discount_amount || 0),
      shipping: Number(previousOrders._sum.shipping_cost || 0),
      tax: Number(previousOrders._sum.tax_amount || 0),
    });
    const prevTaxes = Number(previousOrders._sum.tax_amount || 0);
    const prevNetProfit = prevIncome - previousCogs.cogs - previousExpenses;

    return {
      total_income: round2(totalIncome),
      total_expenses: round2(currentExpenses),
      cost_of_goods_sold: round2(totalCogs),
      gross_profit: round2(grossProfit),
      gross_margin: round2(grossMargin),
      net_profit: round2(netProfit),
      net_margin: round2(netMargin),
      breakeven_ratio: round2(breakevenRatio),
      total_taxes: round2(totalTaxes),
      // `null` = the previous period had no base to compare against. Rendering it
      // as "0 %" would assert "no change" about a period that had nothing.
      income_growth: computeGrowth(totalIncome, prevIncome),
      expenses_growth: computeGrowth(currentExpenses, previousExpenses),
      net_profit_growth: computeGrowth(netProfit, prevNetProfit),
      taxes_growth: computeGrowth(totalTaxes, prevTaxes),
      /** Auditability of the COGS above — see `CostCoverage`. */
      cost_coverage: currentCogs.coverage,
    };
  }

  async getOverviewTrends(query: AnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth). Buckets by the store's LOCAL
    // calendar so a sale at 23:00 local time lands on the correct day.
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);
    const expenseRange = resolveLocalDateOnlyRange(query, tz);

    const salesPeriodSql = localPeriodSql('o.created_at', tz, granularity);
    // `expense_date` is ALREADY the local calendar date — bucket it without the
    // tz conversion, or it lands one day early.
    const expensePeriodSql = dateOnlyPeriodSql('e.expense_date', granularity);
    const saleStates = sqlStateList(COMPLETED_SALE_STATES);
    const expenseStates = sqlStateList(RECOGNIZED_EXPENSE_STATES);

    // Sales per period. `period` is the authoritative LOCAL label emitted as TEXT
    // by the SQL. The item subquery is pre-aggregated per order_id (never a flat
    // join) so the order-level columns are not multiplied by the item count, and
    // it carries the same store/state/window filter so it cannot scan the world.
    const salesResults = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        revenue: unknown;
        cost_of_goods: unknown;
        taxes: unknown;
        units: unknown;
        units_without_cost: unknown;
      }>
    >`
      SELECT
        ${salesPeriodSql} AS period,
        COALESCE(SUM(o.subtotal_amount - COALESCE(o.discount_amount, 0) + COALESCE(o.shipping_cost, 0)), 0) AS revenue,
        COALESCE(SUM(COALESCE(oi.cogs, 0)), 0) AS cost_of_goods,
        COALESCE(SUM(COALESCE(o.tax_amount, 0)), 0) AS taxes,
        COALESCE(SUM(COALESCE(oi.units, 0)), 0) AS units,
        COALESCE(SUM(COALESCE(oi.units_without_cost, 0)), 0) AS units_without_cost
      FROM orders o
      LEFT JOIN (
        SELECT
          i.order_id,
          SUM(i.quantity * COALESCE(i.cost_price, 0)) AS cogs,
          SUM(i.quantity) AS units,
          SUM(CASE WHEN i.cost_price IS NULL THEN i.quantity ELSE 0 END) AS units_without_cost
        FROM order_items i
        INNER JOIN orders po ON po.id = i.order_id
        WHERE po.store_id = ${storeId}
          AND po.state IN (${saleStates})
          AND po.created_at >= ${startDate}
          AND po.created_at <= ${endDate}
        GROUP BY i.order_id
      ) oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN (${saleStates})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Expenses per period, in naive date-only space.
    const expenseResults = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; expenses: unknown }>
    >`
      SELECT
        ${expensePeriodSql} AS period,
        COALESCE(SUM(e.amount), 0) AS expenses
      FROM expenses e
      WHERE e.store_id = ${storeId}
        AND e.state IN (${expenseStates})
        AND e.expense_date >= ${expenseRange.startDate}
        AND e.expense_date <= ${expenseRange.endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Build expense map for merging. `period` is already the authoritative
    // local label from SQL — do NOT re-derive it in JS.
    const expenseMap = new Map<string, number>();
    for (const r of expenseResults) {
      expenseMap.set(r.period, Number(r.expenses));
    }

    // Merge sales + expenses
    const merged = salesResults.map((r) => {
      const key = r.period;
      const revenue = Number(r.revenue);
      const costOfGoods = Number(r.cost_of_goods);
      const taxes = Number(r.taxes);
      const expenses = expenseMap.get(key) || 0;
      expenseMap.delete(key);

      return {
        period: key,
        sales: round2(revenue),
        expenses: round2(expenses),
        taxes: round2(taxes),
        cost_of_goods: round2(costOfGoods),
        gross_profit: round2(revenue - costOfGoods),
        // Net subtracts BOTH cost of goods and operating expenses. Omitting COGS
        // here let "Rend. Neto" plot ABOVE "Rend. Bruto" — arithmetically
        // impossible, and visible on the very same chart.
        net_profit: round2(revenue - costOfGoods - expenses),
        units_without_cost: Number(r.units_without_cost),
      };
    });

    // Add expense-only periods (no sales in that period)
    for (const [key, expenses] of expenseMap) {
      merged.push({
        period: key,
        sales: 0,
        expenses: round2(expenses),
        taxes: 0,
        cost_of_goods: 0,
        gross_profit: 0,
        net_profit: round2(-expenses),
        units_without_cost: 0,
      });
    }

    // Sort by period
    merged.sort((a, b) => a.period.localeCompare(b.period));

    return fillTimeSeries(
      merged,
      startDate,
      endDate,
      granularity,
      {
        sales: 0,
        expenses: 0,
        taxes: 0,
        cost_of_goods: 0,
        gross_profit: 0,
        net_profit: 0,
        units_without_cost: 0,
      },
      formatPeriodFromDate,
      tz,
    );
  }
}
