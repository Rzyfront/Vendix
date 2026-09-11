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
import {
  computeGrowth,
  round2,
} from '../analytics-metrics.contract';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CustomersAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  /**
   * ADR-01 (F-002) — ventana de inactividad X de la definición derivada de
   * abandono. Un carrito cuenta como abandonado cuando lleva al menos X
   * minutos sin actividad (`last_activity_at < NOW() - X`), sigue `active`
   * y conserva items. X vive aquí como constante nombrada (sin migración,
   * sin job, solo lectura).
   *
   * 30 minutos: muy por debajo del `cart_expiration_hours` por defecto
   * (24 h), así el carrito es medible mucho antes de que el expiry borre
   * sus items; solo afecta al borde reciente de la ventana actual, las
   * ventanas históricas quedan estables.
   */
  private readonly ABANDONED_CART_INACTIVITY_MINUTES = 30;

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
        customer_id: undefined,
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
        customer_id: undefined,
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { grand_total: true },
    });

    // Previous period revenue for average spend growth
    const previousRevenueAgg = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: undefined,
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: { grand_total: true },
    });

    // Previous active customers count
    const previousActiveCustomers = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: undefined,
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
      customer_id: undefined,
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
        // Prisma 7 rechaza `{ not: null }`. Se usa `NOT` para conservar la
        // intención: excluir las ventas sin cliente del ranking. Poner
        // `customer_id: undefined` quitaría el filtro y metería las ventas
        // anónimas como un cliente más.
        NOT: { customer_id: null },
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

  /**
   * QUI-628 v3 + ADR-01 (F-002) — definición DERIVADA del abandono de
   * carrito. Nada escribe `state = 'abandoned'` (los escritores solo ponen
   * `active`/`converted` y el expiry borra items sin tocar `state`), así
   * que filtrar por el estado almacenado medía ~0 estructural.
   *
   *   abandoned = `carts.state = 'active'`
   *               + `last_activity_at` en la ventana
   *               + `last_activity_at < NOW() - ABANDONED_CART_INACTIVITY_MINUTES`
   *               + con items (`EXISTS cart_items`).
   *               (La migración 20260805120000 ya añade `state`,
   *               `converted_order_id`, `converted_at`, `last_activity_at`
   *               con FK ON DELETE SET NULL + 2 índices).
   *   recovered = `carts.state = 'converted'` contados por `converted_at` en
   *               la ventana — UN MISMO UNIVERSO (carts), no `orders.placed_at`.
   *   rates     = abandonados y recuperados comparten denominador (abandoned
   *               + recovered), así la tarjeta y su % cuadran contra la misma
   *               base.
   *   growth    = `computeGrowth(actual, previo)` del contrato: `null` cuando
   *               el período previo no tiene base (regla 9). Para
   *               `recovery_rate_growth` queda `null` por defecto: el período
   *               previo no usa el nuevo schema, así que un delta sería
   *               fabricación. Cuando ambos períodos vivan bajo la nueva
   *               columna, lo activamos en una iteración siguiente.
   *
   * Lo que ya NO está:
   *   - `recoveredCarts` de `prisma.orders.count` (universo distinto).
   *   - `calculatedRate = orderCount / abandonedCount` y su tope a 100 %.
   *   - `recovered_carts = floor(abandoned * rate / 100)` (derivado falso).
   *   - `recovered_value = abandoned * rate / 100` (idem).
   *   - `recovery_rate_growth: 0` hardcodeado (la UI mostraba "0 %" como
   *     medición real).
   *   - `potential_recovery_value === recovered_value` con dos nombres.
   *
   * Ver contrato: `apps/backend/src/domains/store/analytics/analytics-metrics.contract.ts`
   * Spec que lo blinda: `customers-analytics.service.spec.ts` (QUI-628)
   */
  async getAbandonedCartsSummary(query: AnalyticsQueryDto) {
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

    // Abandoned (ADR-01, definición derivada): state='active' + cart con
    // items + last_activity_at en ventana + inactivo más de X minutos.
    // EXISTS sobre cart_items blinda "carrito sin items" — un carrito
    // vacío técnicamente existe pero NO cuenta como abandono real. El
    // corte de inactividad excluye los carritos que siguen en uso en el
    // borde reciente de la ventana actual.
    const abandonedRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ count: bigint; total_value: number }>
    >`
      SELECT
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'active'
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < NOW() - make_interval(mins => ${this.ABANDONED_CART_INACTIVITY_MINUTES})
        AND EXISTS (
          SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
        )
    `;

    const abandonedCount = Number(abandonedRows[0]?.count || 0);
    const totalAbandonedValue = Number(abandonedRows[0]?.total_value || 0);

    // Recovered: state='converted' + converted_at en ventana. UNA sola
    // columna de fecha (converted_at, NO placed_at) — el ticket es del
    // carrito, no de la orden; el vínculo `converted_order_id` es solo
    // para auditoría.
    const recoveredRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ count: bigint; total_value: number }>
    >`
      SELECT
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'converted'
        AND c.converted_at >= ${startDate}
        AND c.converted_at <= ${endDate}
    `;

    const recoveredCount = Number(recoveredRows[0]?.count || 0);
    const totalRecoveredValue = Number(recoveredRows[0]?.total_value || 0);

    // Período previo: solo el lado de abandonados tiene historia honesta
    // porque `converted_at` es columna nueva. El de recuperados lo
    // dejamos en `null` por ahora y lo activamos cuando el backfill cubra
    // al menos una ventana comparable.
    const previousAbandonedRows = await (this.prisma.withoutScope() as any)
      .$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(c.id) AS count
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'active'
        AND c.last_activity_at >= ${previousStartDate}
        AND c.last_activity_at <= ${previousEndDate}
        AND c.last_activity_at < NOW() - make_interval(mins => ${this.ABANDONED_CART_INACTIVITY_MINUTES})
        AND EXISTS (
          SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
        )
    `;
    const previousAbandonedCount = Number(
      previousAbandonedRows[0]?.count || 0,
    );

    const total = abandonedCount + recoveredCount;
    const abandonmentRate =
      total > 0 ? round2((abandonedCount / total) * 100) : 0;
    const recoveryRate =
      total > 0 ? round2((recoveredCount / total) * 100) : 0;

    const abandonmentRateGrowth = computeGrowth(
      abandonedCount,
      previousAbandonedCount,
    );

    return {
      total_abandoned_carts: abandonedCount,
      total_abandoned_value: totalAbandonedValue,
      abandonment_rate: abandonmentRate,
      abandonment_rate_growth: abandonmentRateGrowth,
      recovered_carts: recoveredCount,
      recovered_value: totalRecoveredValue,
      recovery_rate: recoveryRate,
      // Honesto: el período previo no tiene la columna `converted_at`
      // poblada para carts pre-fix. Hasta que el backfill cubra la
      // ventana comparable, mostrar 0 % mentiría.
      recovery_rate_growth: null,
      average_cart_value:
        abandonedCount > 0
          ? round2(totalAbandonedValue / abandonedCount)
          : 0,
    };
  }

  async getAbandonedCartsTrends(query: AnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // QUI-628 v3 — bucketing por la columna de tiempo REAL de cada lado:
    //   - abandoned: last_activity_at (la última interacción con el carrito)
    //   - recovered: converted_at (el momento en que se convirtió en orden)
    // Cada bucket devuelve un único universo (carts) con su propia ventana
    // local. La agregación final une los dos buckets en memoria por período.
    const abandonedPeriodSql = localPeriodSql(
      'c.last_activity_at',
      tz,
      granularity,
    );
    const recoveredPeriodSql = localPeriodSql(
      'c.converted_at',
      tz,
      granularity,
    );

    const abandonedRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; count: bigint; cart_value: number }>
    >`
      SELECT
        ${abandonedPeriodSql} AS period,
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS cart_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'active'
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < NOW() - make_interval(mins => ${this.ABANDONED_CART_INACTIVITY_MINUTES})
        AND EXISTS (
          SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
        )
      GROUP BY 1
    `;

    const recoveredRows = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; count: bigint; cart_value: number }>
    >`
      SELECT
        ${recoveredPeriodSql} AS period,
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS cart_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'converted'
        AND c.converted_at >= ${startDate}
        AND c.converted_at <= ${endDate}
      GROUP BY 1
    `;

    const recoveredMap = new Map<string, number>();
    recoveredRows.forEach((r) =>
      recoveredMap.set(r.period, Number(r.count)),
    );

    return fillTimeSeries(
      abandonedRows.map((r) => {
        const periodKey = r.period;
        const abandonedCount = Number(r.count);
        const recoveredCount = recoveredMap.get(periodKey) || 0;
        const total = abandonedCount + recoveredCount;

        return {
          period: periodKey,
          abandoned_carts: abandonedCount,
          recovered_carts: recoveredCount,
          abandonment_rate:
            total > 0 ? round2((abandonedCount / total) * 100) : 0,
          recovery_rate:
            total > 0 ? round2((recoveredCount / total) * 100) : 0,
          cart_value: Number(r.cart_value),
        };
      }),
      startDate,
      endDate,
      granularity,
      {
        abandoned_carts: 0,
        recovered_carts: 0,
        abandonment_rate: 0,
        recovery_rate: 0,
        cart_value: 0,
      },
      formatPeriodFromDate,
      tz,
    );
  }

  /**
   * HONEST rename: lo que se mide aquí es la HORA LOCAL DEL DÍA en que se
   * creó el carrito abandonado, NO la causa del abandono. La vista de UI
   * debe titularse "Abandono por hora del día" (o equivalente) para no
   * inducir al operador a leer estos datos como motivo.
   *
   * Si en el futuro capturamos la causa real (evento de checkout
   * abandonado, sesión cerrada, etc.), esta función se queda como proxy
   * honesto y se agrega un endpoint paralelo con la causa.
   */
  async getAbandonedCartsByReason(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Filtrar por carritos realmente abandonados (definición derivada
    // ADR-01: state='active' + inactivo más de X + con items), no por
    // TODOS los carritos del período. Antes este query contaba cualquier
    // carrito creado — incluyendo los convertidos, los vacíos y los activos
    // — y los etiquetaba como "motivos", lo cual es fabricación pura.
    const hourBuckets = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ hour: number; count: bigint; total_value: number }>
    >`
      SELECT
        EXTRACT(HOUR FROM ${localBucketSql('c.last_activity_at', tz)}) AS hour,
        COUNT(c.id) AS count,
        COALESCE(SUM(c.subtotal), 0) AS total_value
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'active'
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < NOW() - make_interval(mins => ${this.ABANDONED_CART_INACTIVITY_MINUTES})
        AND EXISTS (
          SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
        )
      GROUP BY EXTRACT(HOUR FROM ${localBucketSql('c.last_activity_at', tz)})
    `;

    const totalAbandoned = hourBuckets.reduce(
      (sum, r) => sum + Number(r.count),
      0,
    );

    const hourBuckets_labels = [
      { minHour: 0, maxHour: 6, label: 'Madrugada (00-06h)' },
      { minHour: 6, maxHour: 12, label: 'Mañana (06-12h)' },
      { minHour: 12, maxHour: 18, label: 'Tarde (12-18h)' },
      { minHour: 18, maxHour: 24, label: 'Noche (18-24h)' },
    ];

    const periodMap = new Map<string, { count: number; total_value: number }>();
    for (const r of hourBuckets) {
      const hour = Number(r.hour);
      const period = hourBuckets_labels.find(
        (p) => hour >= p.minHour && hour < p.maxHour,
      );
      const label = period?.label || 'Otro';
      const existing = periodMap.get(label) || {
        count: 0,
        total_value: 0,
      };
      existing.count += Number(r.count);
      existing.total_value += Number(r.total_value);
      periodMap.set(label, existing);
    }

    return Array.from(periodMap.entries())
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        total_value: data.total_value,
        percentage:
          totalAbandoned > 0 ? round2((data.count / totalAbandoned) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getAbandonedCartsForExport(query: AnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // QUI-628 v3 — export alineado con la pantalla: solo carritos realmente
    // abandonados, ordenados por `last_activity_at`. `abandonment_reason` se
    // deja como `null` (antes era hardcoded "No especificada", lo cual
    // invitaba a leerlo como dato). El XLSX debe mostrar la columna con un
    // placeholder honesto tipo "Sin causa capturada" (ver UI del reporte).
    const cartsData = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        id: number;
        subtotal: number;
        last_activity_at: Date;
        user_id: number;
      }>
    >`
      SELECT c.id, c.subtotal, c.last_activity_at, c.user_id
      FROM carts c
      WHERE c.store_id = ${storeId}
        AND c.state = 'active'
        AND c.last_activity_at >= ${startDate}
        AND c.last_activity_at <= ${endDate}
        AND c.last_activity_at < NOW() - make_interval(mins => ${this.ABANDONED_CART_INACTIVITY_MINUTES})
        AND EXISTS (
          SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id
        )
      ORDER BY c.last_activity_at DESC
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
        // Antes: 'No especificada' hardcoded. Ahora: null — la causa no se
        // captura hoy y mentirla es peor que un campo vacío.
        abandonment_reason: null,
        value: Number(cart.subtotal || 0),
        created_at: cart.last_activity_at ?? null,
        abandoned_at: cart.last_activity_at ?? null,
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
}
