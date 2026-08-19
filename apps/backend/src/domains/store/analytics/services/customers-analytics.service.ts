import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UserRole } from '../../../auth/enums/user-role.enum';
import {
  AnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import {
  formatPeriodFromDate,
  parseDateRange,
  getPreviousPeriod,
} from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  localPeriodSql,
  localBucketSql,
} from '@common/utils/store-timezone.util';
import {
  COMPLETED_SALE_STATES,
  computeGrowth,
  computeOperatingRevenue,
  round2 as roundMoney,
} from '../analytics-metrics.contract';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CustomersAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  /** Single rounding policy — delegates to the contract. */
  private round2(value: number): number {
    return roundMoney(value);
  }

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context.
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  async getCustomersSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Customer role filter (correct - counts users with 'customer' role in the store)
    const customerRoleFilter = {
      store_users: { some: { store_id: storeId } },
      user_roles: { some: { roles: { name: UserRole.CUSTOMER } } },
    };

    // Total customers in the store (via users with customer role).
    // This is a STOCK snapshot as of `now()` — not a flow — so we don't
    // apply a date filter.
    const totalCustomers = await this.prisma.users.count({
      where: customerRoleFilter,
    });

    // Active customers: distinct customers with at least 1 completed order
    // in the period. The active count is a FLOW (counts the period's
    // shoppers, not a perpetual photo).
    const activeCustomers = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: [...COMPLETED_SALE_STATES] },
        customer_id: { not: null },
        created_at: { gte: startDate, lte: endDate },
      },
    });

    // QUI-626 defect 1: new customers of THIS store use store_users.createdAt,
    // not users.created_at (the global sign-up date). A user can register on
    // another tenant and link to this store later; their global sign-up
    // isn't their link-to-this-store date.
    //
    // store_users is the join table; we filter by store_id AND by the user
    // having the customer role (via user_roles).
    const newCustomerWhere: Prisma.store_usersWhereInput = {
      store_id: storeId,
      createdAt: { gte: startDate, lte: endDate },
      user: {
        user_roles: {
          some: { roles: { name: UserRole.CUSTOMER } },
        },
      },
    };
    const newCustomers = await this.prisma.store_users.count({
      where: newCustomerWhere,
    });

    const previousNewCustomers = await this.prisma.store_users.count({
      where: {
        ...newCustomerWhere,
        createdAt: { gte: previousStartDate, lte: previousEndDate },
      },
    });

    // QUI-626 defect 2: revenue uses OPERATING revenue (subtotal - discount +
    // shipping) per the contract, NOT grand_total (which folds VAT in and
    // would make the panel disagree with the other views of the same period).
    const revenueAgg = await this.prisma.orders.aggregate({
      where: {
        state: { in: [...COMPLETED_SALE_STATES] },
        customer_id: { not: null },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        shipping_cost: true,
        tax_amount: true,
      },
    });
    const previousRevenueAgg = await this.prisma.orders.aggregate({
      where: {
        state: { in: [...COMPLETED_SALE_STATES] },
        customer_id: { not: null },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        shipping_cost: true,
        tax_amount: true,
      },
    });

    const previousActiveCustomers = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: [...COMPLETED_SALE_STATES] },
        customer_id: { not: null },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
    });

    const activeCount = activeCustomers.length;
    const previousActiveCount = previousActiveCustomers.length;
    // Operating revenue (contract) — same definition as Resumen General and
    // Estado de Resultados, so the three views reconcile.
    const totalRevenue = computeOperatingRevenue({
      subtotal: Number(revenueAgg._sum.subtotal_amount || 0),
      discounts: Number(revenueAgg._sum.discount_amount || 0),
      shipping: Number(revenueAgg._sum.shipping_cost || 0),
      tax: Number(revenueAgg._sum.tax_amount || 0),
    });
    const previousRevenue = computeOperatingRevenue({
      subtotal: Number(previousRevenueAgg._sum.subtotal_amount || 0),
      discounts: Number(previousRevenueAgg._sum.discount_amount || 0),
      shipping: Number(previousRevenueAgg._sum.shipping_cost || 0),
      tax: Number(previousRevenueAgg._sum.tax_amount || 0),
    });

    const averageSpend = activeCount > 0 ? totalRevenue / activeCount : 0;
    const previousAverageSpend =
      previousActiveCount > 0 ? previousRevenue / previousActiveCount : 0;

    // QUI-626 defect 4: computeGrowth returns null when the previous base
    // is 0, instead of a misleading 0 % (which falsely read as "no change").
    const newCustomersGrowth = computeGrowth(newCustomers, previousNewCustomers);
    const averageSpendGrowth = computeGrowth(averageSpend, previousAverageSpend);

    return {
      total_customers: totalCustomers,
      active_customers: activeCount,
      // QUI-626 defect 3: `inactive = total - active` mixed a stock with a
      // flow. Removed from the response. If the operator wants inactive, it
      // must be defined as "no orders in the last N days" and declared as such
      // (separate ticket).
      new_customers: newCustomers,
      new_customers_growth:
        newCustomersGrowth === null ? null : Math.round(newCustomersGrowth * 10) / 10,
      average_spend: Math.round(averageSpend * 100) / 100,
      average_spend_growth:
        averageSpendGrowth === null ? null : Math.round(averageSpendGrowth * 10) / 10,
    };
  }

  async getCustomersTrends(query: AnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // Bucket by the store's LOCAL calendar via the authoritative TEXT label.
    const periodSql = localPeriodSql('u.created_at', tz, granularity);

    // New customers by period (using users.created_at with customer role)
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        new_customers: bigint;
      }>
    >`
      SELECT
        ${periodSql} AS period,
        COUNT(DISTINCT u.id) AS new_customers
      FROM users u
      WHERE EXISTS (
        SELECT 1 FROM store_users su2
        WHERE su2.user_id = u.id AND su2.store_id = ${storeId}
      )
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.name = ${UserRole.CUSTOMER}
      )
      AND u.created_at >= ${startDate}
      AND u.created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Get cumulative total before start date
    const cumulativeBefore = await (this.prisma.withoutScope() as any)
      .$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT u.id) AS count
      FROM users u
      WHERE EXISTS (
        SELECT 1 FROM store_users su2
        WHERE su2.user_id = u.id AND su2.store_id = ${storeId}
      )
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.name = ${UserRole.CUSTOMER}
      )
      AND u.created_at < ${startDate}
    `;

    // Cumulative running total at the END of the window (used below as the
    // seed for fillTimeSeries). The fill is responsible for the per-bucket
    // running total — see the post-fill pass below.
    const cumulativeAfterWindow = Number(cumulativeBefore[0]?.count || 0);

    const mapped = results.map((r) => ({
      // period is already the authoritative local label from SQL.
      period: r.period,
      new_customers: Number(r.new_customers),
    }));

    // fillTimeSeries generates missing periods (gaps) with `cumulative_customers`
    // unset. We re-derive the running total in time order so the cumulative
    // stays FLAT across gaps and grows by `new_customers` only on real buckets.
    // Pre-fix this used `cumulative_customers: cumulative` (the END value) as the
    // fill template, which made every gap look like the window closed early.
    const filled = fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { new_customers: 0 },
      formatPeriodFromDate,
      tz,
    );

    let running = cumulativeAfterWindow;
    const withCumulative = filled.map((b) => {
      running += (b as any).new_customers;
      return {
        ...(b as any),
        cumulative_customers: running,
      };
    });
    return withCumulative as any;
  }

  async getTopCustomers(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const isPaginated = query.page !== undefined && query.limit !== undefined;

    const where = {
      state: { in: this.COMPLETED_STATES },
      customer_id: { not: null },
      created_at: { gte: startDate, lte: endDate },
    };

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;

      const countGroups = await this.prisma.orders.groupBy({
        by: ['customer_id'],
        where,
      });
      const totalCount = countGroups.length;

      const results = await this.prisma.orders.groupBy({
        by: ['customer_id'],
        where,
        _sum: { grand_total: true },
        _count: { id: true },
        _max: { created_at: true },
        orderBy: { _sum: { grand_total: 'desc' } },
        skip: (page - 1) * limit,
        take: limit,
      });

      const customerIds = results
        .map((r) => r.customer_id)
        .filter(Boolean) as number[];
      const customers = await this.prisma.users.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
        },
      });
      const customerMap = new Map(customers.map((c) => [c.id, c]));

      const data = results.map((r) => {
        const customer = customerMap.get(r.customer_id as number);
        return {
          id: r.customer_id,
          customer_name:
            `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
          first_name: customer?.first_name || '',
          last_name: customer?.last_name || '',
          email: customer?.email || '',
          total_orders: r._count.id || 0,
          total_spent: Number(r._sum.grand_total || 0),
          last_order_date: r._max.created_at?.toISOString() || null,
        };
      });

      return {
        data,
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

    // Non-paginated (retrocompatible)
    const results = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where,
      _sum: { grand_total: true },
      _count: { id: true },
      _max: { created_at: true },
      orderBy: { _sum: { grand_total: 'desc' } },
      take: 10,
    });

    const customerIds = results
      .map((r) => r.customer_id)
      .filter(Boolean) as number[];
    const customers = await this.prisma.users.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return results.map((r) => {
      const customer = customerMap.get(r.customer_id as number);
      return {
        id: r.customer_id,
        customer_name:
          `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
        first_name: customer?.first_name || '',
        last_name: customer?.last_name || '',
        email: customer?.email || '',
        total_orders: r._count.id || 0,
        total_spent: Number(r._sum.grand_total || 0),
        last_order_date: r._max.created_at?.toISOString() || null,
      };
    });
  }

  /**
   * QUI-541: variante flat-array de getTopCustomers para XLSX. Devuelve
   * TODOS los clientes ordenados por gasto (no solo top 10) con la
   * misma forma de fila pero con `last_order_date` como `Date` cruda
   * (no string) para que el emitter XLSX la formatee con la TZ de
   * la tienda.
   */
  async getTopCustomersForExport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const results = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { grand_total: true },
      _count: { id: true },
      _max: { created_at: true },
      orderBy: { _sum: { grand_total: 'desc' } },
      take: 10000,
    });

    const customerIds = results
      .map((r) => r.customer_id)
      .filter(Boolean) as number[];
    const customers = await this.prisma.users.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return results.map((r) => {
      const customer = customerMap.get(r.customer_id as number);
      return {
        id: r.customer_id,
        customer_name:
          `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
        first_name: customer?.first_name || '',
        last_name: customer?.last_name || '',
        email: customer?.email || '',
        total_orders: r._count.id || 0,
        total_spent: Math.round(Number(r._sum.grand_total || 0) * 100) / 100,
        // RAW Date — el emitter la formatea con TZ. NULL si nunca ha
        // comprado (no debería pasar porque la query filtra customer_id NOT NULL).
        last_order_date: r._max.created_at ?? null,
      };
    });
  }

  /**
   * QUI-540: cuentas por cobrar de clientes con bucketing de antigüedad.
   *
   * Una fila por `accounts_receivable` con status='open' o 'partial',
   * enriquecida con datos del cliente y bucketed en:
   *   - '0-30 días' (current)
   *   - '31-60 días'
   *   - '61-90 días'
   *   - '90+ días' (riesgo de incobrabilidad)
   *
   * El campo `days_overdue` que ya existe en la tabla lo respetamos si
   * está poblado; si no, lo calculamos desde `due_date` vs `now()`.
   *
   * `issue_date` y `due_date` son DATE (sin hora), pero Prisma los devuelve
   * como Date instants. El emitter los formatea con TZ.
   */
  async getAccountsReceivableForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const receivables = await this.prisma.accounts_receivable.findMany({
      where: {
        store_id: storeId,
        status: { in: ['open', 'partial'] },
        balance: { gt: 0 },
      },
      select: {
        id: true,
        customer_id: true,
        source_type: true,
        source_id: true,
        document_number: true,
        original_amount: true,
        paid_amount: true,
        balance: true,
        currency: true,
        issue_date: true,
        due_date: true,
        days_overdue: true,
        last_payment_date: true,
        status: true,
        customer: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            document_number: true,
          },
        },
      },
      orderBy: { due_date: 'asc' },
      take: 10000,
    });

    const now = new Date();

    return receivables.map((r) => {
      const days = r.days_overdue > 0
        ? r.days_overdue
        : Math.max(0, Math.floor((now.getTime() - r.due_date.getTime()) / 86400000));
      const bucket =
        days <= 30
          ? '0-30'
          : days <= 60
            ? '31-60'
            : days <= 90
              ? '61-90'
              : '90+';
      const customerName = r.customer
        ? `${r.customer.first_name || ''} ${r.customer.last_name || ''}`.trim()
        : '';
      return {
        id: r.id,
        customer_id: r.customer_id,
        customer_name: customerName,
        customer_email: r.customer?.email ?? '',
        customer_document: r.customer?.document_number ?? '',
        document_number: r.document_number ?? '',
        source_type: r.source_type,
        source_id: r.source_id,
        issue_date: r.issue_date,
        due_date: r.due_date,
        days_overdue: days,
        aging_bucket: bucket,
        original_amount: Math.round(Number(r.original_amount) * 100) / 100,
        paid_amount: Math.round(Number(r.paid_amount) * 100) / 100,
        balance: Math.round(Number(r.balance) * 100) / 100,
        currency: r.currency,
        status: r.status,
        last_payment_date: r.last_payment_date,
      };
    });
  }

  async getCustomersChannels(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const customerRoleFilter = {
      store_users: { some: { store_id: storeId } },
      user_roles: { some: { roles: { name: UserRole.CUSTOMER } } },
    };

    const totalCustomers = await this.prisma.users.count({
      where: customerRoleFilter,
    });

    const newCustomers = await this.prisma.users.count({
      where: {
        ...customerRoleFilter,
        created_at: { gte: startDate, lte: endDate },
      },
    });

    const channelStats = await this.prisma.orders.groupBy({
      by: ['channel'],
      where: {
        store_id: storeId,
        state: { in: this.COMPLETED_STATES },
        created_at: { gte: startDate, lte: endDate },
      },
      _count: { id: true },
      _sum: { grand_total: true },
    });

    const channels = channelStats.map((ch) => ({
      channel: ch.channel,
      orders: ch._count.id,
      revenue: Number(ch._sum.grand_total || 0),
      percentage: ch._count.id > 0 ? (ch._count.id / (channelStats.reduce((a, b) => a + b._count.id, 0))) * 100 : 0,
    }));

    return {
      summary: {
        total_customers: totalCustomers,
        total_new_customers: newCustomers,
        total_orders: channelStats.reduce((a, b) => a + b._count.id, 0),
        total_revenue: channelStats.reduce((a, b) => a + Number(b._sum.grand_total || 0), 0),
      },
      channels,
    };
  }

  async getCustomersForExport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Get all store customers (with customer role) and their order aggregates
    const storeCustomers = await this.prisma.users.findMany({
      where: {
        store_users: { some: { store_id: storeId } },
        user_roles: { some: { roles: { name: UserRole.CUSTOMER } } },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        created_at: true,
        state: true,
      },
    });

    const userIds = storeCustomers.map((u) => u.id);

    // Get order aggregates per customer in period
    const orderAggs = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { in: userIds },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { grand_total: true },
      _count: { id: true },
      _max: { created_at: true },
    });

    const aggMap = new Map(orderAggs.map((a) => [a.customer_id, a]));

    return storeCustomers.map((user) => {
      const agg: any = aggMap.get(user.id);
      const customerName =
        `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente';

      return {
        name: customerName,
        email: user.email || '',
        phone: user.phone || '',
        total_orders: agg?._count?.id || 0,
        total_spent: Number(agg?._sum?.grand_total || 0),
        last_order_date: agg?._max?.created_at ?? null,
        registration_date: user.created_at ?? null,
        state: user.state,
      };
    });
  }

  // ==================== ABANDONED CARTS ANALYTICS ====================

  async getAbandonedCartsSummary(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(startDate, endDate);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Operational definition (QUI-628):
    //   abandoned = cart with items + no converted_order_id + last_activity_at
    //               older than the threshold (default 60 min). The threshold is
    //               defined relative to the moment the query runs (NOW()), not
    //               relative to endDate, because the question being answered is
    //               "right now, how many carts are abandoned?" — a cart whose
    //               last activity was 5 minutes ago is NOT abandoned yet, even
    //               if its last activity falls inside the period window.
    //   recovered = cart with state='converted' AND converted_at in the period.
    //
    // Time dimension is one column per side:
    //   abandoned -> carts.last_activity_at (the moment the user stopped being
    //                active; created_at would never move)
    //   recovered -> carts.converted_at (the moment the order was placed from
    //                this cart — set by the checkout hook + backfill)
    const rawClient = (this.prisma as any).withoutScope() as {
      $queryRaw: <T>(query: any) => Promise<T>;
    };

    const abandonedRows = await rawClient.$queryRaw<
      Array<{ count: bigint; total_value: string | number }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(c.subtotal), 0) AS total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < (NOW() - INTERVAL '60 minutes')
        AND c.converted_order_id IS NULL
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
    `);

    // QUI-628 review: recovered_value must come from the ORDER (linked via
    // c.converted_order_id), not from c.subtotal. After checkout, clearCart()
    // zeroes the cart subtotal, so SUM(c.subtotal) was always 0 for converted
    // carts. The order's operating revenue (subtotal - discount + shipping,
    // excluding IVA) is the real measurement of what the store recovered.
    const recoveredRows = await rawClient.$queryRaw<
      Array<{ count: bigint; total_value: string | number }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(o.subtotal_amount - o.discount_amount + o.shipping_cost), 0) AS total_value
      FROM carts c
      INNER JOIN orders o ON o.id = c.converted_order_id
      WHERE c.store_id = ${storeId}
        AND c.state = 'converted'
        AND c.converted_at >= ${startDate}
        AND c.converted_at <= ${endDate}
    `);

    const abandonedCount = Number(abandonedRows[0]?.count ?? 0);
    const totalAbandonedValue = Number(abandonedRows[0]?.total_value ?? 0);
    const recoveredCount = Number(recoveredRows[0]?.count ?? 0);
    const totalRecoveredValue = Number(recoveredRows[0]?.total_value ?? 0);

    // Previous period for growth: same definition, previous window.
    const previousAbandonedRows = await rawClient.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.last_activity_at >= ${previousStartDate}
        AND c.last_activity_at <= ${previousEndDate}
        AND c.last_activity_at < (NOW() - INTERVAL '60 minutes')
        AND c.converted_order_id IS NULL
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
    `);
    const previousAbandonedCount = Number(
      previousAbandonedRows[0]?.count ?? 0,
    );

    const totalObserved = abandonedCount + recoveredCount;
    // Real metrics — same denominator family (abandoned + recovered). Both
    // sides are now derived from carts, so the rate is internally consistent.
    // The OLD code mixed orders / carts and topped to 100, which made the
    // number look authoritative while being a fabrication.
    const abandonmentRate =
      totalObserved > 0 ? (abandonedCount / totalObserved) * 100 : 0;
    const recoveryRate =
      totalObserved > 0 ? (recoveredCount / totalObserved) * 100 : 0;

    // `computeGrowth` returns `null` when the previous base is 0; the UI must
    // render that as "sin base de comparación", not as 0 % (contract requirement).
    const abandonmentRateGrowth = computeGrowth(abandonedCount, previousAbandonedCount);

    return {
      total_abandoned_carts: abandonedCount,
      total_abandoned_value: totalAbandonedValue,
      abandonment_rate: this.round2(abandonmentRate),
      abandonment_rate_growth:
        abandonmentRateGrowth === null ? null : this.round2(abandonmentRateGrowth),
      recovered_carts: recoveredCount,
      recovered_value: totalRecoveredValue,
      recovery_rate: this.round2(recoveryRate),
      recovery_rate_growth: null, // previous recovered set was fabricated; null until both periods use the new schema
      average_cart_value:
        abandonedCount > 0 ? totalAbandonedValue / abandonedCount : 0,
    };
  }

  async getAbandonedCartsTrends(query: AnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // QUI-628 (C8): two-column window — abandoned and recovered each drive
    // from THEIR OWN timestamp column, never parallel dates. The abandoned
    // bucket uses `carts.last_activity_at` (the moment the user stopped being
    // active); the recovered bucket uses `carts.converted_at` (set by the
    // checkout hook + backfill).
    //
    // tz-audit:ignore — `last_activity_at` and `converted_at` are INSTANTES
    // (UTC at rest; the window above already comes from parseDateRange which
    // emits UTC bounds for localPeriodSql to wrap with the right TZ).
    const abandonedPeriodSql = localPeriodSql('c.last_activity_at', tz, granularity);
    const recoveredPeriodSql = localPeriodSql('c.converted_at', tz, granularity);

    const abandonedRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; abandoned_carts: bigint; cart_value: string | number }>
    >`
      SELECT
        ${abandonedPeriodSql} AS period,
        COUNT(c.id) AS abandoned_carts,
        COALESCE(SUM(c.subtotal), 0) AS cart_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < (NOW() - INTERVAL '60 minutes')
        AND c.converted_order_id IS NULL
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const recoveredRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; recovered_carts: bigint }>
    >`
      SELECT
        ${recoveredPeriodSql} AS period,
        COUNT(c.id) AS recovered_carts
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'converted'
        AND c.converted_at >= ${startDate}
        AND c.converted_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const recoveredMap = new Map<string, number>();
    for (const r of recoveredRows) {
      recoveredMap.set(r.period, Number(r.recovered_carts));
    }

    return fillTimeSeries(
      abandonedRows.map((r) => {
        const abandonedCount = Number(r.abandoned_carts);
        const recoveredCount = recoveredMap.get(r.period) || 0;
        // QUI-628 (C2/C3/C5): rate is now FROM THE SAME NUMERATOR/DENOMINATOR
        // FAMILY (carts, not orders). Both sides derive from carts so the rate
        // is internally consistent — no `min(...,100)`, no `100 - recovery`.
        const totalObserved = abandonedCount + recoveredCount;
        const abandonmentRate =
          totalObserved > 0 ? (abandonedCount / totalObserved) * 100 : 0;
        const recoveryRate =
          totalObserved > 0 ? (recoveredCount / totalObserved) * 100 : 0;

        return {
          period: r.period,
          abandoned_carts: abandonedCount,
          recovered_carts: recoveredCount,
          cart_value: Number(r.cart_value),
          abandonment_rate: roundMoney(abandonmentRate),
          recovery_rate: roundMoney(recoveryRate),
        };
      }),
      startDate,
      endDate,
      granularity,
      {
        abandoned_carts: 0,
        recovered_carts: 0,
        cart_value: 0,
        abandonment_rate: 0,
        recovery_rate: 0,
      },
      formatPeriodFromDate,
      tz,
    );
  }

  async getAbandonedCartsByReason(query: AnalyticsQueryDto) {
    // QUI-628 (C7): this endpoint is HONESTLY about hour-of-day, not cause.
    // The label is renamed at the controller / frontend so the user sees
    // "Abandono por hora del día" — which is what the data is — instead of
    // "motivo de abandono", which the data is NOT. Until a real cause signal
    // exists (e.g. checkout_step_at which cart exited, payment failure), the
    // dimension we can report is when, not why.
    //
    // The COUNT is filtered to TRUE abandoned carts (operational definition),
    // not every cart that ever existed — same fix as the summary endpoint.
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const abandonedByHour = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ hour: number; count: bigint; total_value: string | number }>
    >`
      SELECT
        EXTRACT(HOUR FROM ${localBucketSql('c.last_activity_at', tz)}) AS hour,
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < (NOW() - INTERVAL '60 minutes')
        AND c.converted_order_id IS NULL
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
      GROUP BY 1
      ORDER BY count DESC
    `;

    const totalAbandoned = abandonedByHour.reduce(
      (sum, r) => sum + Number(r.count),
      0,
    );

    const hourBuckets = [
      { minHour: 0, maxHour: 6, label: 'Madrugada (00-06h)' },
      { minHour: 6, maxHour: 12, label: 'Mañana (06-12h)' },
      { minHour: 12, maxHour: 18, label: 'Tarde (12-18h)' },
      { minHour: 18, maxHour: 24, label: 'Noche (18-24h)' },
    ];

    const periodMap = new Map<string, { count: number; total_value: number }>();
    for (const r of abandonedByHour) {
      const hour = Number(r.hour);
      const bucket = hourBuckets.find(
        (b) => hour >= b.minHour && hour < b.maxHour,
      );
      const label = bucket?.label || 'Otro';
      const existing = periodMap.get(label) || { count: 0, total_value: 0 };
      existing.count += Number(r.count);
      existing.total_value += Number(r.total_value);
      periodMap.set(label, existing);
    }

    // Output shape: `bucket` (was `reason`) so callers stop reading "reason"
    // as causation. The label itself is "Abandono por hora del día — <bucket>".
    return Array.from(periodMap.entries())
      .map(([bucket, data]) => ({
        bucket,
        count: data.count,
        total_value: roundMoney(data.total_value),
        percentage:
          totalAbandoned > 0
            ? roundMoney((data.count / totalAbandoned) * 100)
            : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getAbandonedCartsForExport(query: AnalyticsQueryDto) {
    // QUI-628 (C9): export only TRUE abandoned carts (operational definition),
    // and stop claiming a "motivo" we don't have. Column renamed to
    // `last_activity_local` so the spreadsheet doesn't imply a cause.
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const abandonedCarts = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        id: number;
        subtotal: string | number;
        last_activity_at: Date;
        user_id: number;
        items_count: bigint;
      }>
    >`
      SELECT
        c.id,
        c.subtotal,
        c.last_activity_at,
        c.user_id,
        (SELECT COUNT(*) FROM cart_items ci WHERE ci.cart_id = c.id) AS items_count
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < (NOW() - INTERVAL '60 minutes')
        AND c.converted_order_id IS NULL
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
      ORDER BY c.last_activity_at DESC
    `;

    const userIds = abandonedCarts.map((c) => c.user_id).filter(Boolean) as number[];
    const customers = await this.prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, first_name: true, last_name: true, email: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return abandonedCarts.map((cart) => {
      const customer = customerMap.get(cart.user_id);
      return {
        id: cart.id,
        reference: `CART-${cart.id}`,
        customer_name: customer
          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
          : 'Cliente invitado',
        email: customer?.email || '',
        items_count: Number(cart.items_count),
        value: roundMoney(Number(cart.subtotal || 0)),
        last_activity_local: cart.last_activity_at ?? null,
      };
    });
  }

  /**
   * QUI-539: cartera de clientes por días SIN comprar. Para cada
   * cliente con al menos una orden completada, calcula los días
   * desde su última orden hasta ahora, y bucket:
   *   - '0-30' (activo reciente)
   *   - '31-60' (enfriándose)
   *   - '61-90' (dormido)
   *   - '90+' (riesgo de churn)
   *
   * Sirve para campañas de reactivación: target los 90+ con
   * descuento, los 31-60 con email, etc.
   *
   * NO filtra por el rango de fechas de `query`: la métrica es «cuánto
   * lleva sin comprar», que sólo tiene sentido contra el histórico
   * completo. Acotarla al período convertiría a todo cliente anterior
   * al rango en un falso «sin-orden».
   */
  async getCustomersAgingForExport(_query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Última orden completada por cliente
    const orders = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        stores: { id: storeId }, // filtro de scope del store
      },
      _max: { created_at: true },
      _sum: { grand_total: true },
      _count: { id: true },
    });

    const customerIds = orders
      .map((o) => o.customer_id)
      .filter(Boolean) as number[];

    const customers = await this.prisma.users.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        document_number: true,
        created_at: true,
      },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const now = new Date();

    return orders
      .map((o) => {
        const customerId = o.customer_id as number;
        const customer = customerMap.get(customerId);
        const customerName = customer
          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
          : '';
        const lastOrder = o._max.created_at;
        const days = lastOrder
          ? Math.floor((now.getTime() - lastOrder.getTime()) / 86400000)
          : null;
        const bucket =
          days === null
            ? 'sin-orden'
            : days <= 30
              ? '0-30'
              : days <= 60
                ? '31-60'
                : days <= 90
                  ? '61-90'
                  : '90+';
        return {
          customer_id: customerId,
          customer_name: customerName,
          customer_email: customer?.email ?? '',
          customer_document: customer?.document_number ?? '',
          // RAW Date — el emitter la formatea con la TZ de la tienda.
          customer_since: customer?.created_at ?? null,
          last_order_date: lastOrder,
          days_since_last_order: days,
          aging_bucket: bucket,
          total_orders: o._count.id ?? 0,
          lifetime_value:
            o._sum.grand_total != null
              ? Math.round(Number(o._sum.grand_total) * 100) / 100
              : 0,
        };
      })
      .sort(
        (a, b) =>
          (b.days_since_last_order ?? 0) - (a.days_since_last_order ?? 0),
      );
  }
}
