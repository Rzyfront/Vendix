import { Injectable, ForbiddenException } from '@nestjs/common';
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

    // Total customers in the store (via users with customer role)
    const totalCustomers = await this.prisma.users.count({
      where: customerRoleFilter,
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

    // New customers in period (store_users created in date range with customer role)
    const newCustomers = await this.prisma.users.count({
      where: {
        ...customerRoleFilter,
        created_at: { gte: startDate, lte: endDate },
      },
    });

    // New customers in previous period (for growth calculation)
    const previousNewCustomers = await this.prisma.users.count({
      where: {
        ...customerRoleFilter,
        created_at: { gte: previousStartDate, lte: previousEndDate },
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
    const previousAverageSpend =
      previousActiveCount > 0 ? previousRevenue / previousActiveCount : 0;

    const newCustomersGrowth =
      previousNewCustomers > 0
        ? ((newCustomers - previousNewCustomers) / previousNewCustomers) * 100
        : 0;

    const averageSpendGrowth =
      previousAverageSpend > 0
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
   */
  async getCustomersAgingForExport(query: AnalyticsQueryDto) {
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
      take: 10000, // defensa: limit superior explícito (vendix-report-xlsx R4)
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
      .sort((a, b) => (b.days_since_last_order ?? 0) - (a.days_since_last_order ?? 0));
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
