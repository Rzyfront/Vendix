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
} from '../analytics-metrics.contract';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CustomersAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

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

    let cumulative = Number(cumulativeBefore[0]?.count || 0);

    const mapped = results.map((r) => {
      const newCustomers = Number(r.new_customers);
      cumulative += newCustomers;
      return {
        // period is already the authoritative local label from SQL.
        period: r.period,
        new_customers: newCustomers,
        cumulative_customers: cumulative,
      };
    });

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { new_customers: 0, cumulative_customers: cumulative },
      formatPeriodFromDate,
      tz,
    );
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

    // Abandoned carts: carts created in period
    // Using a proxy: count carts created and calculate based on cart interactions
    const abandonedCarts = await (this.prisma.withoutScope() as any).$queryRaw<Array<{ count: bigint; total_value: number }>>`
      SELECT
        COUNT(c.id) as count,
        COALESCE(SUM(c.subtotal), 0) as total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.created_at >= ${startDate}
        AND c.created_at <= ${endDate}
    `;

    const abandonedCount = Number(abandonedCarts[0]?.count || 0);
    const totalAbandonedValue = Number(abandonedCarts[0]?.total_value || 0);

    // For recovery, we count orders created from carts in period
    // Using EXTRACT to match carts by user and approximate time window
    const recoveredCarts = await this.prisma.orders.count({
      where: {
        store_id: storeId,
        created_at: { gte: startDate, lte: endDate },
        // Orders that appear to be from carts (using a heuristic: created within 24h of a cart)
      },
    });

    // Previous period for growth calculation
    const previousAbandoned = await (this.prisma.withoutScope() as any).$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(c.id) as count
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.created_at >= ${previousStartDate}
        AND c.created_at <= ${previousEndDate}
    `;

    const previousAbandonedCount = Number(previousAbandoned[0]?.count || 0);

    const completedOrders = await (this.prisma.withoutScope() as any).$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(o.id) as count
      FROM orders o
      WHERE o.store_id = ${storeId}
        AND o.placed_at >= ${startDate}
        AND o.placed_at <= ${endDate}
        AND o.state IN ('delivered', 'finished')
    `;
    const orderCount = Number(completedOrders[0]?.count || 0);

    let recoveryRate: number;
    if (abandonedCount > 0 && orderCount > 0) {
      const calculatedRate = (orderCount / abandonedCount) * 100;
      recoveryRate = Math.min(Math.round(calculatedRate * 10) / 10, 100);
    } else if (abandonedCount === 0) {
      recoveryRate = 0;
    } else {
      recoveryRate = 0;
    }

    const abandonmentRate = abandonedCount > 0 ? 100 - recoveryRate : 0;

    const abandonmentRateGrowth =
      previousAbandonedCount > 0
        ? ((abandonedCount - previousAbandonedCount) / previousAbandonedCount) * 100
        : 0;

    return {
      total_abandoned_carts: abandonedCount,
      total_abandoned_value: totalAbandonedValue,
      abandonment_rate: abandonmentRate,
      abandonment_rate_growth: abandonmentRateGrowth,
      recovered_carts: Math.floor(abandonedCount * (recoveryRate / 100)),
      recovered_value: totalAbandonedValue * (recoveryRate / 100),
      recovery_rate: recoveryRate,
      recovery_rate_growth: 0,
      average_cart_value:
        abandonedCount > 0 ? totalAbandonedValue / abandonedCount : 0,
      potential_recovery_value: totalAbandonedValue * (recoveryRate / 100),
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

    // Bucket by the store's LOCAL calendar via the authoritative TEXT label.
    const cartsPeriodSql = localPeriodSql('c.created_at', tz, granularity);
    const ordersPeriodSql = localPeriodSql('o.placed_at', tz, granularity);

    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        abandoned_carts: bigint;
        cart_value: number;
      }>
    >`
      SELECT
        ${cartsPeriodSql} AS period,
        COUNT(c.id) AS abandoned_carts,
        COALESCE(SUM(c.subtotal), 0) as cart_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.created_at >= ${startDate}
        AND c.created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const completedOrders = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        order_count: bigint;
      }>
    >`
      SELECT
        ${ordersPeriodSql} AS period,
        COUNT(o.id) AS order_count
      FROM orders o
      WHERE o.store_id = ${storeId}
        AND o.placed_at >= ${startDate}
        AND o.placed_at <= ${endDate}
        AND o.state IN ('delivered', 'finished')
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const ordersMap = new Map<string, number>();
    completedOrders.forEach(o => {
      // period is already the authoritative local label from SQL.
      ordersMap.set(o.period, Number(o.order_count));
    });

    let defaultRecoveryRate = 0;
    let defaultAbandonmentRate = 0;

    return fillTimeSeries(
      results.map((r) => {
        const periodKey = r.period;
        const orderCount = ordersMap.get(periodKey) || 0;
        const cartCount = Number(r.abandoned_carts);
        
        let recoveryRate: number;
        if (cartCount > 0 && orderCount > 0) {
          const calculatedRate = (orderCount / cartCount) * 100;
          recoveryRate = Math.min(Math.round(calculatedRate * 10) / 10, 100);
        } else {
          recoveryRate = 0;
        }

        return {
          period: periodKey,
          abandoned_carts: cartCount,
          recovered_carts: Math.floor(cartCount * (recoveryRate / 100)),
          abandonment_rate: cartCount > 0 ? 100 - recoveryRate : 0,
          recovery_rate: recoveryRate,
        };
      }),
      startDate,
      endDate,
      granularity,
      {
        abandoned_carts: 0,
        recovered_carts: 0,
        abandonment_rate: defaultAbandonmentRate,
        recovery_rate: defaultRecoveryRate,
      },
      formatPeriodFromDate,
      tz,
    );
  }

  async getAbandonedCartsByReason(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Group carts by hour of day as a proxy for abandonment patterns
    const abandonedCartsData = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        hour: number;
        count: bigint;
        total_value: number;
      }>
    >`
      SELECT
        EXTRACT(HOUR FROM ${localBucketSql('c.created_at', tz)}) as hour,
        COUNT(c.id) as count,
        COALESCE(SUM(c.subtotal), 0) as total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.created_at >= ${startDate}
        AND c.created_at <= ${endDate}
      GROUP BY EXTRACT(HOUR FROM ${localBucketSql('c.created_at', tz)})
      ORDER BY count DESC
    `;

    const totalCarts = abandonedCartsData.reduce(
      (sum, r) => sum + Number(r.count),
      0,
    );

    // Map hours to time-of-day periods
    const hourReasons = [
      { minHour: 0, maxHour: 6, label: 'Madrugada (00-06h)' },
      { minHour: 6, maxHour: 12, label: 'Mañana (06-12h)' },
      { minHour: 12, maxHour: 18, label: 'Tarde (12-18h)' },
      { minHour: 18, maxHour: 24, label: 'Noche (18-24h)' },
    ];

    // Group by time period
    const periodMap = new Map<string, { count: number; total_value: number }>();

    for (const r of abandonedCartsData) {
      const hour = Number(r.hour);
      const period = hourReasons.find(
        (p) => hour >= p.minHour && hour < p.maxHour,
      );
      const label = period?.label || 'Otro';
      const existing = periodMap.get(label) || { count: 0, total_value: 0 };
      existing.count += Number(r.count);
      existing.total_value += Number(r.total_value);
      periodMap.set(label, existing);
    }

    const result = Array.from(periodMap.entries())
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        total_value: data.total_value,
        percentage: totalCarts > 0 ? (data.count / totalCarts) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return result;
  }

  async getAbandonedCartsForExport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const cartsData = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        id: number;
        subtotal: number;
        created_at: Date;
        user_id: number;
      }>
    >`
      SELECT c.id, c.subtotal, c.created_at, c.user_id
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.created_at >= ${startDate}
        AND c.created_at <= ${endDate}
      ORDER BY c.created_at DESC
    `;

    const userIds = cartsData.map((c) => c.user_id).filter(Boolean) as number[];

    const customers = await this.prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, first_name: true, last_name: true, email: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return cartsData.map((cart) => {
      const customer = customerMap.get(cart.user_id);
      return {
        id: cart.id,
        reference: `CART-${cart.id}`,
        customer_name: customer
          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
          : 'Cliente invitado',
        email: customer?.email || '',
        abandonment_reason: 'No especificada',
        value: Number(cart.subtotal || 0),
        created_at: cart.created_at ?? null,
        abandoned_at: cart.created_at ?? null,
      };
    });
  }
}
