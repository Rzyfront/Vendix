import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  AnalyticsQueryDto,
  PurchasesBySupplierQueryDto,
} from '../dto/analytics-query.dto';
import { getPreviousPeriod, parseDateRange } from '../utils/date.util';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  PURCHASE_COMMITTED_STATES,
  computeGrowth,
  round2,
  sqlStateList,
} from '../analytics-metrics.contract';

/**
 * Shape returned by {@link PurchasesAnalyticsService.aggregatePurchaseWindow}.
 * Kept explicit so the current and previous windows are provably the same
 * calculation — the growth of a KPI is only meaningful when both sides came
 * out of the same aggregation.
 */
interface PurchaseWindowAggregate {
  /** Committed orders in the window. */
  orderCount: number;
  /** SUM(subtotal_amount) of committed orders — the spend, VAT excluded. */
  netSpend: number;
  /** SUM(items.tax_amount) — VAT the suppliers charged, from the LINES. */
  taxCharged: number;
  /** SUM(items.deductible_tax_amount) — VAT sealed as descontable (O-48). */
  taxDeductible: number;
  /** SUM(items.capitalized_tax_amount) — VAT sealed into cost (O-49). */
  taxCapitalized: number;
  /** Ordered units, expressed in the MINIMUM STOCK unit. */
  unitsOrdered: number;
  /** Received units, expressed in the MINIMUM STOCK unit. */
  unitsReceived: number;
  /**
   * Units the suppliers still owe, in the MINIMUM STOCK unit.
   *
   * Computed PER LINE as `GREATEST(ordered - received, 0)`, never as the
   * difference of the two totals. Measured on store 10: item 488 has 1 unit
   * ordered and 99 received on a product whose `purchase_to_stock_factor` is
   * 1 000 000, so a totals-difference turned the store's real backlog into
   * -86 999 981 — one over-received line erasing every genuine shortfall.
   */
  unitsPending: number;
  /** Order count per status, including the states left out of the spend. */
  ordersByStatus: Record<string, number>;
}

@Injectable()
export class PurchasesAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Committed orders still awaiting full reception. Derived from the contract
   * so it can never drift from what counts as spend: `received` is the only
   * committed state that is finished.
   */
  private readonly PENDING_STATES = PURCHASE_COMMITTED_STATES.filter(
    (s) => s !== 'received',
  );
  private readonly COMPLETED_STATES = ['received'] as const;

  /**
   * Aggregates ONE window of purchases for a store, in DB.
   *
   * Both the current and the previous window go through this same function so a
   * growth figure is always a comparison of identical calculations. Everything
   * is aggregated in Postgres: the previous implementation pulled every order
   * with its full `purchase_order_items` and `payments` into memory just to sum
   * them, which grew linearly with volume and never paginated.
   *
   * `withoutScope()` is required because the scoped store client does not expose
   * `$queryRaw` (only `$queryRawUnsafe`); the tenant filter is re-applied
   * explicitly with `organization_id` + `l.store_id` on every query, and the
   * caller has already validated both against the request context.
   */
  private async aggregatePurchaseWindow(
    organizationId: number,
    storeId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<PurchaseWindowAggregate> {
    const rawClient = this.prisma.withoutScope() as any;

    // The store universe is `location.store_id`, NOT `suppliers.store_id`:
    // `purchase_orders.location_id` is NOT NULL and always resolves to a store,
    // while `suppliers.store_id` is nullable, so filtering by supplier would
    // silently drop every purchase made to an organization-level supplier.
    // `getPurchasesBySupplier` uses this same universe so both views reconcile.
    const statusRows = await rawClient.$queryRaw<
      Array<{ status: string; orders: bigint; net_spend: number }>
    >`
      SELECT po.status::text AS status,
             count(*)::bigint AS orders,
             COALESCE(sum(po.subtotal_amount), 0)::float8 AS net_spend
      FROM purchase_orders po
      JOIN inventory_locations l ON l.id = po.location_id
      WHERE po.organization_id = ${organizationId}
        AND l.store_id = ${storeId}
        AND po.order_date >= ${startDate}
        AND po.order_date <= ${endDate}
      GROUP BY po.status
    `;

    // VAT and units come from the LINES, never from the order header.
    // Measured on store 10: orders in `prices_include_tax` mode carry their VAT
    // in `purchase_order_items.tax_amount` (2394.96, 1277.31) while
    // `purchase_orders.tax_amount` stays at 0 — reading the header under-reports
    // the VAT of every include-tax purchase.
    //
    // Units are multiplied by `purchase_to_stock_factor` so a "unit" is always
    // the minimum stock unit and the figure never mixes boxes with loose units.
    const itemRows = await rawClient.$queryRaw<
      Array<{
        tax_charged: number;
        tax_deductible: number;
        tax_capitalized: number;
        units_ordered: number;
        units_received: number;
        units_pending: number;
      }>
    >`
      SELECT COALESCE(sum(i.tax_amount), 0)::float8 AS tax_charged,
             COALESCE(sum(i.deductible_tax_amount), 0)::float8 AS tax_deductible,
             COALESCE(sum(i.capitalized_tax_amount), 0)::float8 AS tax_capitalized,
             COALESCE(sum(i.quantity_ordered * COALESCE(p.purchase_to_stock_factor, 1)), 0)::float8 AS units_ordered,
             COALESCE(sum(i.quantity_received * COALESCE(p.purchase_to_stock_factor, 1)), 0)::float8 AS units_received,
             COALESCE(sum(GREATEST(i.quantity_ordered - i.quantity_received, 0) * COALESCE(p.purchase_to_stock_factor, 1)), 0)::float8 AS units_pending
      FROM purchase_order_items i
      JOIN purchase_orders po ON po.id = i.purchase_order_id
      JOIN inventory_locations l ON l.id = po.location_id
      JOIN products p ON p.id = i.product_id
      WHERE po.organization_id = ${organizationId}
        AND l.store_id = ${storeId}
        AND po.status::text IN (${sqlStateList(PURCHASE_COMMITTED_STATES)})
        AND po.order_date >= ${startDate}
        AND po.order_date <= ${endDate}
    `;

    const ordersByStatus: Record<string, number> = {};
    let orderCount = 0;
    let netSpend = 0;
    for (const row of statusRows) {
      const count = Number(row.orders);
      ordersByStatus[row.status] = count;
      if ((PURCHASE_COMMITTED_STATES as readonly string[]).includes(row.status)) {
        orderCount += count;
        netSpend += Number(row.net_spend);
      }
    }

    const items = itemRows[0];
    return {
      orderCount,
      netSpend,
      taxCharged: Number(items?.tax_charged ?? 0),
      taxDeductible: Number(items?.tax_deductible ?? 0),
      taxCapitalized: Number(items?.tax_capitalized ?? 0),
      unitsOrdered: Number(items?.units_ordered ?? 0),
      unitsReceived: Number(items?.units_received ?? 0),
      unitsPending: Number(items?.units_pending ?? 0),
      ordersByStatus,
    };
  }

  async getPurchasesSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    // tz-audit:ignore — `purchase_orders.order_date` is an INSTANT (verified in
    // DB: 2026-08-01 20:51:46.54, real clock time), not a naive business-date,
    // so the window comes from parseDateRange and never from
    // resolveLocalDateOnlyRange.
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const [current, previous] = await Promise.all([
      this.aggregatePurchaseWindow(
        organizationId,
        storeId,
        startDate,
        endDate,
      ),
      this.aggregatePurchaseWindow(
        organizationId,
        storeId,
        previousStartDate,
        previousEndDate,
      ),
    ]);

    const pendingOrders = this.PENDING_STATES.reduce(
      (sum, state) => sum + (current.ordersByStatus[state] ?? 0),
      0,
    );
    const completedOrders = this.COMPLETED_STATES.reduce(
      (sum, state) => sum + (current.ordersByStatus[state] ?? 0),
      0,
    );

    const averageOrderValue =
      current.orderCount > 0 ? current.netSpend / current.orderCount : 0;
    const previousAverage =
      previous.orderCount > 0 ? previous.netSpend / previous.orderCount : 0;

    return {
      total_orders: current.orderCount,
      // Spend EXCLUDES VAT: purchase VAT is not a cost, it is either deductible
      // against the DIAN (O-48, PUC 240804) or already capitalized into
      // inventory cost (O-49). Summing `total_amount` inflated this figure by
      // the VAT and made it irreconcilable with the income statement.
      total_spent: round2(current.netSpend),
      pending_orders: pendingOrders,
      completed_orders: completedOrders,
      total_items_ordered: round2(current.unitsOrdered),
      total_items_received: round2(current.unitsReceived),
      pending_units: round2(current.unitsPending),
      // Three VAT figures, not one: what the suppliers charged, how much of it
      // is recoverable in the declaration, and how much went into the cost of
      // the goods. A store that is not VAT-responsible (O-49) has
      // `tax_deductible = 0` and a card labelled "descontable" would lie to it.
      total_tax_amount: round2(current.taxCharged),
      deductible_tax_amount: round2(current.taxDeductible),
      capitalized_tax_amount: round2(current.taxCapitalized),
      average_order_value: round2(averageOrderValue),
      // `null` = the previous window had no base to compare against. The UI must
      // render it as "sin base", never as 0 %.
      total_spent_growth: computeGrowth(current.netSpend, previous.netSpend),
      total_orders_growth: computeGrowth(
        current.orderCount,
        previous.orderCount,
      ),
      average_order_value_growth: computeGrowth(
        averageOrderValue,
        previousAverage,
      ),
      // Every status, including the ones deliberately left out of the spend, so
      // the screen can show WHY an order is not in the figure.
      orders_by_status: current.ordersByStatus,
      committed_states: [...PURCHASE_COMMITTED_STATES],
      /** The universe this view aggregates over — see aggregatePurchaseWindow. */
      store_scope: 'location',
    };
  }

  /**
   * Per-supplier purchase volume for ONE window, aggregated in DB.
   *
   * The query is driven FROM `purchase_orders`, not from `suppliers`. The old
   * implementation listed `suppliers WHERE store_id = :storeId` and hung the
   * orders off each row, which silently dropped every purchase made to an
   * organization-level supplier (`suppliers.store_id IS NULL`) — measured on
   * store 10: 24 of the 39 committed orders and $20 427 387,15 of $30 637 514,88
   * (67 % of the spend) were invisible here while the summary counted them.
   * Same universe as `aggregatePurchaseWindow` so the two views reconcile.
   */
  private async aggregateSupplierWindow(
    organizationId: number,
    storeId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      supplier_id: number;
      supplier_name: string;
      order_count: number;
      total_spent: number;
      tax_amount: number;
      pending_orders: number;
      last_order_date: Date | null;
    }>
  > {
    const rawClient = this.prisma.withoutScope() as any;

    // The supplier's own `state` is deliberately NOT filtered: excluding
    // archived suppliers would erase purchases that really happened and break
    // reconciliation against accounting. What IS filtered is the ORDER status.
    const rows = await rawClient.$queryRaw<
      Array<{
        supplier_id: number;
        supplier_name: string;
        order_count: bigint;
        total_spent: number;
        tax_amount: number;
        pending_orders: bigint;
        last_order_date: Date | null;
      }>
    >`
      SELECT s.id AS supplier_id,
             s.name AS supplier_name,
             count(DISTINCT po.id)::bigint AS order_count,
             COALESCE(sum(po.subtotal_amount), 0)::float8 AS total_spent,
             COALESCE((
               SELECT sum(i.tax_amount)
               FROM purchase_order_items i
               WHERE i.purchase_order_id IN (
                 SELECT po2.id FROM purchase_orders po2
                 JOIN inventory_locations l2 ON l2.id = po2.location_id
                 WHERE po2.supplier_id = s.id
                   AND po2.organization_id = ${organizationId}
                   AND l2.store_id = ${storeId}
                   AND po2.status::text IN (${sqlStateList(PURCHASE_COMMITTED_STATES)})
                   AND po2.order_date >= ${startDate}
                   AND po2.order_date <= ${endDate}
               )
             ), 0)::float8 AS tax_amount,
             count(DISTINCT po.id) FILTER (WHERE po.status::text <> 'received')::bigint AS pending_orders,
             max(po.order_date) AS last_order_date
      FROM purchase_orders po
      JOIN inventory_locations l ON l.id = po.location_id
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.organization_id = ${organizationId}
        AND l.store_id = ${storeId}
        AND po.status::text IN (${sqlStateList(PURCHASE_COMMITTED_STATES)})
        AND po.order_date >= ${startDate}
        AND po.order_date <= ${endDate}
      GROUP BY s.id, s.name
    `;

    return rows.map((r) => ({
      supplier_id: Number(r.supplier_id),
      supplier_name: r.supplier_name,
      order_count: Number(r.order_count),
      total_spent: Number(r.total_spent),
      tax_amount: Number(r.tax_amount),
      pending_orders: Number(r.pending_orders),
      last_order_date: r.last_order_date ?? null,
    }));
  }

  async getPurchasesBySupplier(
    query: PurchasesBySupplierQueryDto & { page?: number; limit?: number },
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    // tz-audit:ignore — `order_date` is an INSTANT (see getPurchasesSummary).
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const [current, previous] = await Promise.all([
      this.aggregateSupplierWindow(organizationId, storeId, startDate, endDate),
      this.aggregateSupplierWindow(
        organizationId,
        storeId,
        previousStartDate,
        previousEndDate,
      ),
    ]);

    const previousBySupplier = new Map(
      previous.map((p) => [p.supplier_id, p.total_spent]),
    );

    // Denominator for the participation share. Taken from the SAME rows that
    // are about to be emitted, so `SUM(percentage_of_total)` is always 100 and
    // the total reconciles with `purchases/summary.total_spent`.
    const grandTotal = current.reduce((sum, s) => sum + s.total_spent, 0);

    let supplierStats = current
      .map((s) => ({
        supplier_id: s.supplier_id,
        supplier_name: s.supplier_name,
        order_count: s.order_count,
        total_spent: round2(s.total_spent),
        tax_amount: round2(s.tax_amount),
        pending_orders: s.pending_orders,
        last_order_date: s.last_order_date,
        percentage_of_total:
          grandTotal > 0 ? round2((s.total_spent / grandTotal) * 100) : 0,
        growth: computeGrowth(
          s.total_spent,
          previousBySupplier.get(s.supplier_id) ?? 0,
        ),
      }))
      .sort((a, b) => b.total_spent - a.total_spent);

    // Suppliers with no purchases in the window are excluded by default: they
    // add rows to a volume ranking without adding volume. `include_zero=true`
    // brings back the full roster for the callers that want it.
    if (query.include_zero) {
      const seen = new Set(supplierStats.map((s) => s.supplier_id));
      const roster = await this.prisma.suppliers.findMany({
        where: { organization_id: organizationId },
        select: { id: true, name: true },
      });
      for (const supplier of roster) {
        if (seen.has(supplier.id)) continue;
        supplierStats.push({
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          order_count: 0,
          total_spent: 0,
          tax_amount: 0,
          pending_orders: 0,
          last_order_date: null,
          percentage_of_total: 0,
          growth: computeGrowth(0, previousBySupplier.get(supplier.id) ?? 0),
        });
      }
    }

    const serialize = (s: (typeof supplierStats)[number]) => ({
      ...s,
      // Emitted raw (ISO instant); the frontend renders it in the store's TZ.
      last_order_date: s.last_order_date
        ? new Date(s.last_order_date).toISOString()
        : null,
    });

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const total = supplierStats.length;
      const paginatedData = supplierStats.slice(
        (page - 1) * limit,
        page * limit,
      );

      return {
        data: paginatedData.map(serialize),
        meta: {
          pagination: {
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          },
        },
      };
    }

    return supplierStats
      .slice(0, query.limit || supplierStats.length)
      .map(serialize);
  }

  /**
   * QUI-547: serie temporal de compras agregada por período
   * (hour|day|week|month|year según query.granularity, default day).
   *
   * Trae todas las POs del rango y las bucketa en JS. Para un store
   * típico con miles de POs por mes es perfectamente manejable y evita
   * depender de $queryRaw que StorePrismaService no expone. Si el
   * dataset crece a >100k POs por período conviene migrar a SQL
   * nativo.
   */
  async getPurchasesTrendsForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);
    const granularity: Granularity = query.granularity ?? Granularity.DAY;
    const interval = getDateTruncInterval(granularity);

    const purchaseOrders = await this.prisma.purchase_orders.findMany({
      where: {
        organization_id: organizationId,
        location: { store_id: storeId },
        order_date: { gte: startDate, lte: endDate },
      },
      select: {
        status: true,
        total_amount: true,
        order_date: true,
      },
    });

    // Bucketing en JS. Usamos UTC porque la conversión a TZ ya se hizo
    // en parseDateRange, y date_trunc('day', timestamp) en Postgres
    // opera en la TZ de la sesión. Para mantener consistencia con
    // `getDateTruncInterval` (que es solo el nombre del intervalo),
    // truncamos manualmente en UTC al inicio del bucket correspondiente.
    const buckets = new Map<number, {
      period: Date;
      order_count: number;
      total_spent: number;
      pending_count: number;
      completed_count: number;
    }>();

    for (const po of purchaseOrders) {
      const period = truncateToGranularity(po.order_date, granularity);
      const key = period.getTime();
      const bucket = buckets.get(key) ?? {
        period,
        order_count: 0,
        total_spent: 0,
        pending_count: 0,
        completed_count: 0,
      };
      bucket.order_count += 1;
      bucket.total_spent += Number(po.total_amount || 0);
      if (this.PENDING_STATES.includes(po.status as any)) {
        bucket.pending_count += 1;
      } else if (this.COMPLETED_STATES.includes(po.status as any)) {
        bucket.completed_count += 1;
      }
      buckets.set(key, bucket);
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.period.getTime() - b.period.getTime())
      .map((b) => ({
        period: b.period,
        order_count: b.order_count,
        total_spent: Math.round(b.total_spent * 100) / 100,
        pending_count: b.pending_count,
        completed_count: b.completed_count,
        granularity: interval,
      }));
  }

  /**
   * QUI-542: cuentas por pagar a proveedores con bucketing de
   * antigüedad. Toma purchase_orders con payment_status IN
   * ('unpaid', 'partial') y payment_due_date no nulo, calcula días
   * de mora desde payment_due_date vs now(), y bucket:
   *   - '0-30' (corriente)
   *   - '31-60'
   *   - '61-90'
   *   - '90+' (crítico, escalación)
   *
   * Una fila por orden con supplier, total, saldo pendiente, días de
   * mora y bucket.
   */
  async getAccountsPayableForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const orders = await this.prisma.purchase_orders.findMany({
      where: {
        organization_id: organizationId,
        suppliers: { store_id: storeId },
        payment_status: { in: ['unpaid', 'partial'] },
        payment_due_date: { not: null },
      },
      select: {
        id: true,
        order_number: true,
        supplier_invoice_number: true,
        total_amount: true,
        tax_amount: true,
        order_date: true,
        payment_due_date: true,
        payment_status: true,
        suppliers: { select: { id: true, name: true, code: true } },
      },
      orderBy: { payment_due_date: 'asc' },
      take: 10000,
    });

    const now = new Date();

    return orders
      .filter((o) => o.payment_due_date !== null)
      .map((o) => {
        const days = Math.max(
          0,
          Math.floor(
            (now.getTime() - o.payment_due_date!.getTime()) / 86400000,
          ),
        );
        const bucket =
          days <= 30
            ? '0-30'
            : days <= 60
              ? '31-60'
              : days <= 90
                ? '61-90'
                : '90+';
        return {
          id: o.id,
          order_number: o.order_number,
          supplier_invoice_number: o.supplier_invoice_number ?? '',
          supplier_id: o.suppliers.id,
          supplier_name: o.suppliers.name,
          supplier_code: o.suppliers.code ?? '',
          order_date: o.order_date,
          payment_due_date: o.payment_due_date,
          days_overdue: days,
          aging_bucket: bucket,
          total_amount: Math.round(Number(o.total_amount) * 100) / 100,
          tax_amount: Math.round(Number(o.tax_amount || 0) * 100) / 100,
          payment_status: o.payment_status,
        };
      });
  }
}

/**
 * Trunca una fecha al inicio del bucket de granularidad dado (en UTC).
 * Espejo de `date_trunc('<interval>', timestamp)` de Postgres.
 */
function truncateToGranularity(date: Date, granularity: Granularity): Date {
  const d = new Date(date);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  d.setUTCHours(0);
  switch (granularity) {
    case Granularity.HOUR:
      return d;
    case Granularity.YEAR:
      d.setUTCMonth(0);
      d.setUTCDate(1);
      return d;
    case Granularity.MONTH:
      d.setUTCDate(1);
      return d;
    case Granularity.WEEK: {
      // Semana inicia en lunes (ISO 8601). setUTCDate(1 - dayOfWeek) ajusta.
      const day = d.getUTCDay(); // 0=domingo..6=sábado
      const isoDay = day === 0 ? 7 : day; // 1=lunes..7=domingo
      d.setUTCDate(d.getUTCDate() - (isoDay - 1));
      return d;
    }
    case Granularity.DAY:
    default:
      return d;
  }
}
