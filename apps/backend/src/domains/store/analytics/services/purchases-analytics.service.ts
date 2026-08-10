import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
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
      }>
    >`
      SELECT COALESCE(sum(i.tax_amount), 0)::float8 AS tax_charged,
             COALESCE(sum(i.deductible_tax_amount), 0)::float8 AS tax_deductible,
             COALESCE(sum(i.capitalized_tax_amount), 0)::float8 AS tax_capitalized,
             COALESCE(sum(i.quantity_ordered * COALESCE(p.purchase_to_stock_factor, 1)), 0)::float8 AS units_ordered,
             COALESCE(sum(i.quantity_received * COALESCE(p.purchase_to_stock_factor, 1)), 0)::float8 AS units_received
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
      pending_units: round2(current.unitsOrdered - current.unitsReceived),
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

  async getPurchasesBySupplier(
    query: AnalyticsQueryDto & { page?: number; limit?: number },
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // Sin filtro de `state` a propósito: excluir archivados aquí borraría del
    // reporte compras que sí ocurrieron y descuadraría los totales del período
    // contra contabilidad.
    const suppliers = await this.prisma.suppliers.findMany({
      where: {
        organization_id: organizationId,
        store_id: storeId,
      },
      select: {
        id: true,
        name: true,
        purchase_orders: {
          where: {
            organization_id: organizationId,
            location: { store_id: storeId },
            order_date: { // tz-audit:ignore — INSTANTE real (ver arriba)
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            status: true,
            total_amount: true,
            order_date: true,
          },
        },
      },
    });

    const supplierStats = suppliers
      .map((supplier) => {
        const orders = supplier.purchase_orders;
        const totalSpent = orders.reduce(
          (sum, order) => sum + Number(order.total_amount || 0),
          0,
        );
        const pendingOrders = orders.filter((order) =>
          this.PENDING_STATES.includes(order.status as any),
        ).length;
        let lastOrderDate: Date | null = null;
        for (const order of orders) {
          if (
            order.order_date &&
            (!lastOrderDate || order.order_date > lastOrderDate)
          ) {
            lastOrderDate = order.order_date;
          }
        }

        return {
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          order_count: orders.length,
          total_spent: totalSpent,
          pending_orders: pendingOrders,
          last_order_date: lastOrderDate,
        };
      })
      .sort((a, b) => b.total_spent - a.total_spent);

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const total = supplierStats.length;
      const paginatedData = supplierStats.slice((page - 1) * limit, page * limit);

      const mapped = paginatedData.map((s) => ({
        ...s,
        last_order_date: s.last_order_date?.toISOString() || null,
      }));

      return {
        data: mapped,
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

    return supplierStats.slice(0, query.limit || supplierStats.length).map((s) => ({
      ...s,
      last_order_date: s.last_order_date?.toISOString() || null,
    }));
  }
}
