import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto, DatePreset, Granularity } from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';

@Injectable()
export class CustomersAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  async getCustomersSummary(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const { previousStartDate, previousEndDate } = this.getPreviousPeriod(startDate, endDate);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for customers analytics');
    }
    const storeId = context.store_id;

    // Total customers in the store (via store_users)
    const totalCustomers = await this.prisma.store_users.count({
      where: {
        store_id: storeId,
      },
    });

    // Active customers: distinct customers with at least 1 completed order in period
    const activeCustomers = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        created_at: { gte: startDate, lte: endDate },
      },
    });

    // New customers in period (store_users created in date range)
    const newCustomers = await this.prisma.store_users.count({
      where: {
        store_id: storeId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // New customers in previous period (for growth calculation)
    const previousNewCustomers = await this.prisma.store_users.count({
      where: {
        store_id: storeId,
        createdAt: { gte: previousStartDate, lte: previousEndDate },
      },
    });

    // Total revenue from completed orders (for average spend calculation)
    const revenueAgg = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { grand_total: true },
    });

    // Previous period revenue for average spend growth
    const previousRevenueAgg = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: { grand_total: true },
    });

    // Previous active customers count
    const previousActiveCustomers = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: { not: null },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
    });

    const activeCount = activeCustomers.length;
    const previousActiveCount = previousActiveCustomers.length;
    const totalRevenue = Number(revenueAgg._sum.grand_total || 0);
    const previousRevenue = Number(previousRevenueAgg._sum.grand_total || 0);

    const averageSpend = activeCount > 0 ? totalRevenue / activeCount : 0;
    const previousAverageSpend = previousActiveCount > 0 ? previousRevenue / previousActiveCount : 0;

    const newCustomersGrowth = previousNewCustomers > 0
      ? ((newCustomers - previousNewCustomers) / previousNewCustomers) * 100
      : 0;

    const averageSpendGrowth = previousAverageSpend > 0
      ? ((averageSpend - previousAverageSpend) / previousAverageSpend) * 100
      : 0;

    return {
      total_customers: totalCustomers,
      active_customers: activeCount,
      inactive_customers: totalCustomers - activeCount,
      new_customers: newCustomers,
      new_customers_growth: newCustomersGrowth,
      average_spend: averageSpend,
      average_spend_growth: averageSpendGrowth,
    };
  }

  async getCustomersTrends(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for customer trends');
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${this.getDateTruncInterval(granularity)}'`);

    // New customers by period (using store_users creation date)
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        new_customers: bigint;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, su."createdAt") AS period,
        COUNT(DISTINCT su.user_id) AS new_customers
      FROM store_users su
      WHERE su.store_id = ${storeId}
        AND su."createdAt" >= ${startDate}
        AND su."createdAt" <= ${endDate}
      GROUP BY DATE_TRUNC(${truncSql}, su."createdAt")
      ORDER BY period ASC
    `;

    // Get cumulative total before start date
    const cumulativeBefore = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ count: bigint }>
    >`
      SELECT COUNT(DISTINCT su.user_id) AS count
      FROM store_users su
      WHERE su.store_id = ${storeId}
        AND su."createdAt" < ${startDate}
    `;

    let cumulative = Number(cumulativeBefore[0]?.count || 0);

    const mapped = results.map((r) => {
      const newCustomers = Number(r.new_customers);
      cumulative += newCustomers;
      return {
        period: this.formatPeriodFromDate(new Date(r.period), granularity),
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
      this.formatPeriodFromDate.bind(this),
    );
  }

  async getTopCustomers(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

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
      take: 10,
    });

    const customerIds = results.map((r) => r.customer_id).filter(Boolean) as number[];
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
        first_name: customer?.first_name || '',
        last_name: customer?.last_name || '',
        email: customer?.email || '',
        total_orders: r._count.id || 0,
        total_spent: Number(r._sum.grand_total || 0),
        last_order_date: r._max.created_at?.toISOString() || null,
      };
    });
  }

  async getCustomersForExport(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for customers export');
    }
    const storeId = context.store_id;

    // Get all store customers with their order aggregates
    const storeUsers = await this.prisma.store_users.findMany({
      where: { store_id: storeId },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            created_at: true,
            state: true,
          },
        },
      },
    });

    const userIds = storeUsers.map((su) => su.user_id);

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

    return storeUsers.map((su) => {
      const user = su.user;
      const agg: any = aggMap.get(su.user_id);
      const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente';

      return {
        name: customerName,
        email: user.email || '',
        phone: user.phone || '',
        total_orders: agg?._count?.id || 0,
        total_spent: Number(agg?._sum?.grand_total || 0),
        last_order_date: agg?._max?.created_at?.toISOString().split('T')[0] || 'N/A',
        registration_date: user.created_at?.toISOString().split('T')[0] || '',
        state: user.state,
      };
    });
  }

  // ==================== HELPERS ====================

  private parseDateRange(query: AnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
      const endDate = new Date(query.date_to);
      endDate.setUTCHours(23, 59, 59, 999);
      return {
        startDate: new Date(query.date_from),
        endDate,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (query.date_preset) {
      case DatePreset.TODAY:
        return { startDate: today, endDate: now };
      case DatePreset.YESTERDAY:
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: today };
      case DatePreset.THIS_WEEK:
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return { startDate: weekStart, endDate: now };
      case DatePreset.LAST_WEEK:
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay());
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        return { startDate: lastWeekStart, endDate: lastWeekEnd };
      case DatePreset.LAST_MONTH:
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { startDate: lastMonthStart, endDate: lastMonthEnd };
      case DatePreset.THIS_YEAR:
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: now };
      case DatePreset.LAST_YEAR:
        return {
          startDate: new Date(today.getFullYear() - 1, 0, 1),
          endDate: new Date(today.getFullYear() - 1, 11, 31),
        };
      case DatePreset.THIS_MONTH:
      default:
        return { startDate: new Date(today.getFullYear(), today.getMonth(), 1), endDate: now };
    }
  }

  private getPreviousPeriod(startDate: Date, endDate: Date): { previousStartDate: Date; previousEndDate: Date } {
    const duration = endDate.getTime() - startDate.getTime();
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousStartDate = new Date(previousEndDate.getTime() - duration);
    return { previousStartDate, previousEndDate };
  }

  private getDateTruncInterval(granularity: Granularity): string {
    switch (granularity) {
      case Granularity.HOUR: return 'hour';
      case Granularity.DAY: return 'day';
      case Granularity.WEEK: return 'week';
      case Granularity.MONTH: return 'month';
      case Granularity.YEAR: return 'year';
      default: return 'day';
    }
  }

  private formatPeriodFromDate(date: Date, granularity: Granularity): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    switch (granularity) {
      case Granularity.HOUR:
        return `${y}-${m}-${d}T${String(date.getHours()).padStart(2, '0')}:00`;
      case Granularity.DAY:
        return `${y}-${m}-${d}`;
      case Granularity.WEEK:
        return `${y}-${m}-${d}`;
      case Granularity.MONTH:
        return `${y}-${m}`;
      case Granularity.YEAR:
        return `${y}`;
      default:
        return `${y}-${m}-${d}`;
    }
  }
}
