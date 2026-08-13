import { Inject, Injectable, Logger } from '@nestjs/common';
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
  RECOGNIZED_EXPENSE_STATES,
  PURCHASE_COMMITTED_STATES,
  CostCoverage,
  buildCostCoverage,
  computeGrowth,
  computeOperatingRevenue,
  computeNetVatPosition,
  computeEffectiveTaxRate,
  round2 as roundMoney,
  sqlStateList,
  WITHHOLDING_TAX_TYPES,
  WITHHOLDING_SET,
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
  private readonly logger = new Logger(FinancialAnalyticsService.name);

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
    const purchaseStates = sqlStateList(PURCHASE_COMMITTED_STATES);

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

    // QUI-630 defect 4: the DIAN posición needs ALL sides — ventas IVA generado,
    // compras IVA descontable, retenciones practicadas (sales) y retenciones
    // sufridas (purchases). The OLD endpoint only summed IVA from sales and
    // called it `net_tax`, which is NOT the obligation with the DIAN — it's the
    // IVA neto después de reembolsos del cliente, no la posición fiscal real.
    //
    // Source of truth for the formula: `analytics-metrics.contract.ts`
    // (`computeNetVatPosition`). The service is a CONSUMER of that helper.
    //
    // Tenant scoping: `purchase_orders` carries `organization_id` (NOT a
    // direct `store_id`); per `vendix-prisma-scopes` we resolve the store
    // scope through `inventory_locations.store_id`, which `purchase_orders`
    // already FKs to via `location_id`. This keeps the read inside the store
    // tenant without scanning the whole org.
    //
    // KNOWN LIMITATION (QUI-630 review): the INNER JOIN to inventory_locations
    // silently drops any purchase_order whose location_id was deleted (FK not
    // ON DELETE RESTRICT). The store then sees an under-credited posición
    // with no warning. We detect the orphan count via a parallel LEFT JOIN
    // probe and log a warning so the discrepancy is visible in app logs;
    // the data is still NOT counted into the aggregate (a LEFT JOIN would
    // risk including orphaned rows that actually belong to a DIFFERENT store,
    // which is worse than under-counting). Follow-up ticket: enforce FK
    // ON DELETE RESTRICT and treat orphans as a data-integrity error.
    const orphanRows = await rawClient.$queryRaw<Array<{ orphan_count: bigint | number }>>(
      Prisma.sql`
        SELECT COUNT(*) AS orphan_count
        FROM purchase_orders po
        LEFT JOIN inventory_locations il ON po.location_id = il.id
        WHERE po.status IN (${purchaseStates})
          AND po.created_at >= ${startDate}
          AND po.created_at <= ${endDate}
          AND il.id IS NULL
      `,
    );
    const orphanCount = Number(orphanRows[0]?.orphan_count ?? 0);
    if (orphanCount > 0) {
      this.logger.warn(
        `getTaxSummary: ${orphanCount} purchase_order(s) in store_id=${storeId} ` +
          `period ${startDate.toISOString()}..${endDate.toISOString()} reference a ` +
          `deleted inventory_location. Their tax rows are EXCLUDED from the ` +
          `aggregate (inner join). The DIAN posición will be under-counted. ` +
          `See QUI-630 follow-up for the FK enforcement fix.`,
      );
    }

    const purchaseTaxRows = await rawClient.$queryRaw<Array<{
      tax_type: string;
      total_tax: string | number;
      deductible_tax: string | number;
    }>>(Prisma.sql`
      SELECT
        COALESCE(poi.tax_type::text, 'unclassified') AS tax_type,
        SUM(poi.tax_amount)::decimal AS total_tax,
        SUM(poi.deductible_tax_amount)::decimal AS deductible_tax
      FROM purchase_order_items poi
      -- purchase_orders.created_at is an INSTANTE (not a midnight business
      -- date), so the tz-aware parseDateRange window is correct.
      JOIN purchase_orders po ON poi.purchase_order_id = po.id -- tz-audit:ignore
      JOIN inventory_locations il ON po.location_id = il.id
      WHERE il.store_id = ${storeId}
        AND po.status IN (${purchaseStates})
        AND po.created_at >= ${startDate}
        AND po.created_at <= ${endDate}
      GROUP BY COALESCE(poi.tax_type::text, 'unclassified')
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

    // Block sums: IVA generado / INC / ICA (sales) + IVA descontable +
    // retenciones practicadas (sales) / sufridas (purchases). Defaults are 0
    // for blocks with no rows in the period, so the contract's helper is
    // safely called on every period.
    const ivaGenerado = this.sumTaxByType(breakdown, 'iva');
    const incGenerado = this.sumTaxByType(breakdown, 'inc');
    const icaGenerado = this.sumTaxByType(breakdown, 'ica');
    const retePracticadas = this.sumRetenciones(breakdown, WITHHOLDING_TAX_TYPES);
    const ivaDescontable = this.round2(
      purchaseTaxRows
        .filter((r) => r.tax_type === 'iva')
        .reduce((sum, r) => sum + Number(r.deductible_tax ?? 0), 0),
    );
    const reteSufridas = this.round2(
      purchaseTaxRows
        .filter((r) => WITHHOLDING_SET.has(r.tax_type))
        .reduce((sum, r) => sum + Number(r.total_tax ?? 0), 0),
    );

    // NET VAT POSITION — la cifra que la declaración DIAN cierra. Formula
    // belongs to the CONTRACT (`computeNetVatPosition`); this is the
    // single point that reads the helper, so a change to the formula
    // propagates to every consumer instead of silently diverging here.
    const netVatPosition = this.round2(
      computeNetVatPosition({
        iva_generado: ivaGenerado,
        inc_generado: incGenerado,
        ica_generado: icaGenerado,
        iva_descontable: ivaDescontable,
        rete_practicadas: retePracticadas,
        rete_sufridas: reteSufridas,
      }),
    );

    // Effective tax rate stays null (NOT 0) when the period has no taxable
    // revenue — matches the contract's `computeGrowth(null)` semantics and
    // prevents a flat "0 %" badge from masking an empty period.
    const effectiveTaxRateValue = computeEffectiveTaxRate(
      totalTaxCollected,
      taxableRevenueRounded,
    );

    return {
      // Sales-side collected (revenue side of the declaración).
      total_tax_collected: totalTaxCollected,
      total_tax_refunded: totalTaxRefunded,
      total_taxable_revenue: taxableRevenueRounded,
      exempt_revenue: exemptRevenueRounded,
      // Per-tax-type breakdown for the DIAN declaración (QUI-630 defect 4).
      iva_generado: ivaGenerado,
      inc_generado: incGenerado,
      ica_generado: icaGenerado,
      iva_descontable: ivaDescontable,
      rete_practicadas: retePracticadas,
      rete_sufridas: reteSufridas,
      /**
       * NET VAT POSITION — what the store owes the DIAN at the end of the
       * period. Positive: saldo a cargo. Negative: saldo a favor. Formula is
       * in `computeNetVatPosition` (analytics-metrics.contract.ts), which is
       * the single source of truth.
       */
      net_vat_position: netVatPosition,
      /**
       * `net_tax` — net of every tax row minus customer refunds. Historical
       * definition kept for the export's "total a pagar" column. It is NOT
       * the DIAN posición (use `net_vat_position` for the declaración) and
       * it is NOT the "IVA neto" — it sums every tax type (IVA + INC + ICA
       * + retenciones) collected over the period, then subtracts the
       * period's refunds. The label carries the legacy name to avoid
       * breaking the export consumers.
       */
      net_tax: this.round2(totalTaxCollected - totalTaxRefunded),
      /**
       * Effective rate as a percentage of taxable revenue. `null` (NOT `0`)
       * when the period has no taxable revenue — matches the contract's
       * `computeGrowth(null)` semantics.
       */
      effective_tax_rate:
        effectiveTaxRateValue === null ? null : this.round2(effectiveTaxRateValue),
      breakdown,
    };
  }

  /**
   * Sums the `total_tax` field across the rounded breakdown rows for a
   * specific `tax_type`. Used to derive `iva_generado` / `inc_generado` /
   * `ica_generado` from the per-tax-name detail rows without re-querying the DB.
   */
  private sumTaxByType(
    breakdown: ReadonlyArray<{ tax_type: string | null; total_tax: number }>,
    taxType: string,
  ): number {
    return this.round2(
      breakdown
        .filter((b) => b.tax_type === taxType)
        .reduce((sum, b) => sum + b.total_tax, 0),
    );
  }

  /**
   * Sums the `total_tax` field across all retenciones in the breakdown. Used
   * for `rete_practicadas` (sales side). `reteSufridas` is derived from the
   * purchase-side aggregate instead, because purchase-side rows do not
   * belong to the sales breakdown.
   */
  private sumRetenciones(
    breakdown: ReadonlyArray<{ tax_type: string | null; total_tax: number }>,
    taxTypes: readonly string[],
  ): number {
    return this.round2(
      breakdown
        .filter((b) => b.tax_type !== null && taxTypes.includes(b.tax_type))
        .reduce((sum, b) => sum + b.total_tax, 0),
    );
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
    // `v3` = payload shape that carries revenue.total_invoiced, bottom_line.balance
    // and comparison.balance / balance_growth, and that nets refundSubtotal /
    // refundShipping into operating_revenue. Bumped with the shape so a rolling
    // deploy cannot serve a v2-shaped object to a frontend that reads the new
    // fields.
    const cacheKey = `analytics:financial:profit-loss:v3:${storeId}:${query.date_preset ?? '_'}:${query.date_from ?? '_'}:${query.date_to ?? '_'}`;
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
    const rows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ cogs: unknown; units: unknown; units_without_cost: unknown }>
    >`
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
      previousRefundAggregates,
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
      // Previous-period refund aggregate mirrors the current one — needed to
      // derive `previousBalance` (and `balance_growth`) on the same definition
      // as the current `balance` (total_invoiced − refunds − operating_expenses),
      // and to make `revenue_growth` comparable across periods (the previous
      // period's `operating_revenue` must be net of its own refunds too).
      this.prisma.refunds.aggregate({
        where: {
          state: { in: ['completed', 'approved'] },
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
        _sum: {
          amount: true,
          subtotal_refund: true,
          shipping_refund: true,
        },
      }),
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
    const refundAmount = Number(refundAggregates._sum.amount || 0);
    const refundSubtotal = Number(refundAggregates._sum.subtotal_refund || 0);
    const refundTax = Number(refundAggregates._sum.tax_refund || 0);
    const refundShipping = Number(refundAggregates._sum.shipping_refund || 0);
    // REFUND REFLECTION (QUI-662): an order delivered + refunded inside the
    // same period must net to zero, not to the original subtotal. We subtract
    // `refundSubtotal` and add back `refundShipping` so the operating_revenue
    // base and the refund base line up — `computeOperatingRevenue` already
    // excludes tax, so `tax_refund` is intentionally NOT subtracted here.
    const operatingRevenueNetRefunds =
      operatingRevenue - refundSubtotal + refundShipping;
    const grossProfit = operatingRevenueNetRefunds - totalCOGS;
    const grossMargin =
      operatingRevenueNetRefunds > 0
        ? (grossProfit / operatingRevenueNetRefunds) * 100
        : 0;
    const operatingExpenses = expenseAggregates;
    // Net profit now flows from the refund-netted gross profit; we no longer
    // subtract `refundSubtotal` a second time here (it is already reflected
    // inside `operatingRevenueNetRefunds`).
    const netProfit = grossProfit - operatingExpenses;
    const netMargin =
      operatingRevenueNetRefunds > 0
        ? (netProfit / operatingRevenueNetRefunds) * 100
        : 0;
    // TOTAL INVOICED (QUI-662): the gross figure the merchant actually sees as
    // "lo que pagó el cliente" — `SUM(orders.grand_total)` over REVENUE_STATES.
    // Lives inside `_sum` already, so no extra query.
    const totalInvoiced = Number(orderAggregates._sum.grand_total || 0);
    // BALANCE (QUI-662): operational cash position = what was invoiced − what
    // went back as refunds − operating expenses. COGS is intentionally
    // excluded because it is an asset-consumption charge, not a cash outflow
    // ("salidas de dinero que no signifiquen ingreso de un activo").
    const balance = totalInvoiced - refundAmount - operatingExpenses;

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
    // Previous-period balance mirrors the current one (total_invoiced −
    // refunds − operating_expenses) so balance_growth uses identical bases.
    const previousTotalInvoiced = Number(
      previousOrderAggregates._sum.grand_total || 0,
    );
    const previousRefundAmount = Number(
      previousRefundAggregates._sum.amount || 0,
    );
    const previousBalance =
      previousTotalInvoiced - previousRefundAmount - previousExpenseAggregates;
    // Same refund-netting on the previous period so revenue_growth is on
    // identical bases (current `operatingRevenueNetRefunds` vs previous
    // `previousOperatingRevenueNetRefunds`).
    const previousRefundSubtotal = Number(
      previousRefundAggregates._sum.subtotal_refund || 0,
    );
    const previousRefundShipping = Number(
      previousRefundAggregates._sum.shipping_refund || 0,
    );
    const previousOperatingRevenueNetRefunds =
      previousOperatingRevenue -
      previousRefundSubtotal +
      previousRefundShipping;

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
        /**
         * Contract revenue: subtotal − discounts + freight, VAT excluded, with
         * the period's `refundSubtotal` / `refundShipping` netted in. A delivered
         * + refunded order in the same period closes to zero, not to its
         * original subtotal.
         */
        operating_revenue: this.round2(operatingRevenueNetRefunds),
        /** `SUM(orders.grand_total)` over REVENUE_STATES — what the customer paid. */
        total_invoiced: this.round2(totalInvoiced),
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
        /**
         * Operational cash position (QUI-662): total_invoiced − refunds −
         * operating_expenses. COGS is excluded because it is an
         * asset-consumption charge, not a cash outflow.
         */
        balance: this.round2(balance),
        order_count: orderAggregates._count.id || 0,
      },
      /**
       * Previous equivalent period on identical definitions. `*_growth` is `null`
       * when the previous period had no base — rendering that as "0 %" would
       * assert "no change" about a period that had nothing.
       */
      comparison: {
        // Hotfix post-PR-576: emitir el valor NETO de reembolsos para que
        // case con `revenue.operating_revenue` (también neto). Antes la
        // comparación era gross y cualquier cliente que leyera
        // `comparison.operating_revenue` veía una diferencia artificial
        // con la badge `revenue_growth` (que sí es net/net).
        operating_revenue: this.round2(previousOperatingRevenueNetRefunds),
        net_profit: this.round2(previousNetProfit),
        operating_expenses: this.round2(previousExpenseAggregates),
        order_count: previousOrderCount,
        /** Previous-period balance on the same definition as the current `balance`. */
        balance: this.round2(previousBalance),
        revenue_growth: computeGrowth(
          operatingRevenueNetRefunds,
          previousOperatingRevenueNetRefunds,
        ),
        net_profit_growth: computeGrowth(netProfit, previousNetProfit),
        expenses_growth: computeGrowth(
          operatingExpenses,
          previousExpenseAggregates,
        ),
        orders_growth: computeGrowth(
          orderAggregates._count.id || 0,
          previousOrderCount,
        ),
        balance_growth: computeGrowth(balance, previousBalance),
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
