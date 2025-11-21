import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationQueryDto,
  OrganizationDashboardDto,
  OrganizationsDashboardStatsDto,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) { }

  async create(createOrganizationDto: CreateOrganizationDto) {
    const slug = slugify(createOrganizationDto.name, {
      lower: true,
      strict: true,
    });

    const existingOrg = await this.prisma.organizations.findFirst({
      where: { OR: [{ slug }, { tax_id: createOrganizationDto.tax_id }] },
    });

    if (existingOrg) {
      throw new ConflictException(
        'Organization with this slug or tax ID already exists',
      );
    }

    return this.prisma.organizations.create({
      data: {
        ...createOrganizationDto,
        slug,
        updated_at: new Date(),
      },
      include: {
        stores: true,
        addresses: true,
        users: true,
      },
    });
  }

  async findAll(query: OrganizationQueryDto) {
    const { page = 1, limit = 10, search, state } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.organizationsWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { legal_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
    };

    const [organizations, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: { select: { id: true, name: true, is_active: true } },
          addresses: { where: { is_primary: true } },
          _count: { select: { stores: true, users: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data: organizations,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const organization = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        stores: {
          include: { _count: { select: { products: true, orders: true } } },
        },
        addresses: true,
        users: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
        _count: { select: { stores: true, users: true } },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async findBySlug(slug: string) {
    const organization = await this.prisma.organizations.findUnique({
      where: { slug },
      include: { stores: true, addresses: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async update(id: number, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);
    return this.prisma.organizations.update({
      where: { id },
      data: { ...updateOrganizationDto, updated_at: new Date() },
      include: { stores: true, addresses: true, users: true },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    const activeStores = await this.prisma.stores.count({
      where: { organization_id: id, is_active: true },
    });

    if (activeStores > 0) {
      throw new BadRequestException(
        'Cannot delete organization with active stores',
      );
    }

    return this.prisma.organizations.delete({ where: { id } });
  }

  private async getProfitTrendData(organization_id: number, period?: string) {
    let monthsToGenerate = 6; // default

    if (period === '1y') {
      monthsToGenerate = 12;
    } else if (period === 'all') {
      // Get the earliest order date for this organization
      const earliestOrder = await this.prisma.orders.findFirst({
        where: {
          stores: { organization_id },
        },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      });

      if (earliestOrder) {
        const now = new Date();
        const monthsDiff =
          (now.getFullYear() - earliestOrder.created_at.getFullYear()) * 12 +
          (now.getMonth() - earliestOrder.created_at.getMonth());
        monthsToGenerate = Math.max(monthsDiff + 1, 1);
      }
    }

    return Promise.all(
      Array.from({ length: monthsToGenerate }).map(async (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);

        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);

        const [revenueRes, costRes] = await Promise.all([
          // Revenue
          this.prisma.orders.aggregate({
            where: {
              stores: { organization_id },
              created_at: { gte: start, lte: end },
              state: 'finished',
            },
            _sum: { grand_total: true, shipping_cost: true },
          }),
          // Cost of Goods Sold
          this.prisma.order_items.aggregate({
            where: {
              orders: {
                stores: { organization_id: organization_id },
                created_at: { gte: start, lte: end },
                state: 'finished',
              },
            },
            _sum: { total_cost: true },
          }),
        ]);

        const revenue = Number(revenueRes._sum.grand_total || 0);
        const shippingCost = Number(revenueRes._sum.shipping_cost || 0);
        const cogs = Number(costRes._sum.total_cost || 0);
        const totalCosts = shippingCost + cogs;
        const profit = revenue - totalCosts;

        return {
          month: start.toLocaleString('default', { month: 'short' }),
          year: start.getFullYear(),
          amount: profit,
          revenue: revenue,
          costs: totalCosts,
        };
      }),
    );
  }

  async getDashboard(id: number, query: OrganizationDashboardDto) {
    const { start_date, end_date, period } = query;

    // Dates setup
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Default range for charts/lists if not provided
    const startDate =
      start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end_date || new Date();

    const [
      // 1. Total Stores & New this month
      totalStores,
      newStoresThisMonth,

      // 2. Active Users & Online now
      activeUsers,
      onlineUsers,

      // 3. Monthly Orders & Orders today
      monthlyOrders,
      ordersToday,

      // 4. Revenue (Current Month) & Last Month
      revenueCurrentMonth,
      revenueLastMonth,

      // Lists for charts/tables
      storeActivity,
      userGrowth,
      auditActivity,
      profitTrend,
      storeDistribution,
    ] = await Promise.all([
      // Total Stores
      this.prisma.stores.count({
        where: { organization_id: id, is_active: true },
      }),

      // New stores this month
      this.prisma.stores.count({
        where: {
          organization_id: id,
          is_active: true,
          created_at: { gte: currentMonthStart },
        },
      }),

      // Active Users
      this.prisma.users.count({
        where: {
          organization_id: id,
          state: 'active',
        },
      }),

      // Online users (simplified - could be enhanced with actual session tracking)
      this.prisma.users.count({
        where: {
          organization_id: id,
          state: 'active',
          // Add last_seen logic for real online tracking
        },
      }),

      // Monthly Orders
      this.prisma.orders.count({
        where: {
          stores: { organization_id: id },
          created_at: { gte: currentMonthStart },
          state: 'finished',
        },
      }),

      // Orders today
      this.prisma.orders.count({
        where: {
          stores: { organization_id: id },
          created_at: { gte: todayStart },
          state: 'finished',
        },
      }),

      // Revenue Current Month (Profit)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: { organization_id: id },
            created_at: { gte: currentMonthStart },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: { organization_id: id },
              created_at: { gte: currentMonthStart },
              state: 'finished',
            },
          },
          _sum: { total_cost: true },
        }),
      ]).then(([revenueRes, costRes]) => {
        const revenue = Number(revenueRes._sum.grand_total || 0);
        const shippingCost = Number(revenueRes._sum.shipping_cost || 0);
        const cogs = Number(costRes._sum.total_cost || 0);
        return { _sum: { profit: revenue - shippingCost - cogs } };
      }),

      // Profit Last Month (Revenue - Costs)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: { organization_id: id },
            created_at: { gte: lastMonthStart, lte: lastMonthEnd },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: { organization_id: id },
              created_at: { gte: lastMonthStart, lte: lastMonthEnd },
              state: 'finished',
            },
          },
          _sum: { total_cost: true },
        }),
      ]).then(([revenueRes, costRes]) => {
        const revenue = Number(revenueRes._sum.grand_total || 0);
        const shippingCost = Number(revenueRes._sum.shipping_cost || 0);
        const cogs = Number(costRes._sum.total_cost || 0);
        return { _sum: { profit: revenue - shippingCost - cogs } };
      }),

      // Activity by store (for list)
      this.prisma.stores.findMany({
        where: { organization_id: id, is_active: true },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              orders: { where: { created_at: { gte: startDate } } },
              products: true,
              users: true,
            },
          },
        },
      }),

      // User growth (new users per week/day for chart)
      this.prisma.users.groupBy({
        by: ['created_at'],
        where: {
          organization_id: id,
          created_at: { gte: startDate, lte: endDate },
        },
        _count: { id: true },
        orderBy: { created_at: 'asc' },
      }),

      // Audit activity
      this.prisma.audit_logs.findMany({
        where: {
          organization_id: id,
          created_at: { gte: startDate },
        },
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          users: { select: { first_name: true, last_name: true } },
          stores: { select: { name: true } },
        },
      }),

      // Enhanced Profit Trend with period support
      this.getProfitTrendData(id, period),

      // Enhanced Store Distribution by Revenue
      this.getStoreDistributionByRevenue(id),
    ]);

    const currentRev = Number(revenueCurrentMonth._sum.profit || 0);
    const lastRev = Number(revenueLastMonth._sum.profit || 0);
    const revenueDiff = currentRev - lastRev;

    // Process revenue trend (reverse to show chronological order)
    const revenueTrend = profitTrend.reverse();

    return {
      organization_id: id,
      stats: {
        total_stores: {
          value: totalStores,
          sub_value: newStoresThisMonth,
          sub_label: 'new this month',
        },
        active_users: {
          value: activeUsers,
          sub_value: onlineUsers,
          sub_label: 'online now',
        },
        monthly_orders: {
          value: monthlyOrders,
          sub_value: ordersToday,
          sub_label: 'orders today',
        },
        revenue: {
          value: currentRev,
          sub_value: revenueDiff,
          sub_label: 'vs last month',
        },
      },
      metrics: {
        active_users: activeUsers,
        active_stores: totalStores,
        recent_orders: monthlyOrders,
        total_revenue: currentRev,
        growth_trends: userGrowth || [],
      },
      store_activity: storeActivity.map((store) => ({
        id: store.id,
        name: store.name,
        orders_count: store._count.orders,
        products_count: store._count.products,
        users_count: store._count.users,
      })),
      recent_audit: auditActivity.map((log) => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        created_at: log.created_at,
        user: log.users
          ? `${log.users.first_name} ${log.users.last_name}`
          : null,
        store: log.stores?.name,
      })),
      profit_trend: revenueTrend,
      store_distribution: storeDistribution,
    };
  }

  private async getStoreDistributionByRevenue(organization_id: number) {
    // Get revenue by store type for current month
    const currentMonthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    // Get stores with their orders and revenue
    const storesWithRevenue = await this.prisma.stores.findMany({
      where: {
        organization_id,
        is_active: true,
      },
      select: {
        store_type: true,
        orders: {
          where: {
            created_at: { gte: currentMonthStart },
            state: 'finished',
          },
          select: {
            grand_total: true,
          },
        },
      },
    });

    // Calculate revenue by store type
    const revenueByType = storesWithRevenue.reduce(
      (acc, store) => {
        const storeRevenue = store.orders.reduce(
          (sum, order) => sum + Number(order.grand_total || 0),
          0,
        );
        const salesType = store.store_type === 'online' ? 'online' : 'physical';
        acc[salesType] = (acc[salesType] || 0) + storeRevenue;
        return acc;
      },
      {} as Record<string, number>,
    );

    return Object.entries(revenueByType).map(([type, revenue]) => ({
      type,
      revenue,
      percentage: 0, // Will be calculated on frontend
      order_count: 0, // Can be enhanced if needed
    }));
  }

  async getDashboardStats(): Promise<OrganizationsDashboardStatsDto> {
    // Obtener el total de organizaciones
    const total_organizations = await this.prisma.organizations.count();

    // Obtener organizaciones activas
    const active = await this.prisma.organizations.count({
      where: { state: 'active' },
    });

    // Obtener organizaciones inactivas
    const inactive = await this.prisma.organizations.count({
      where: { state: 'inactive' },
    });

    // Obtener organizaciones suspendidas
    const suspended = await this.prisma.organizations.count({
      where: { state: 'suspended' },
    });

    return {
      total_organizations,
      active,
      inactive,
      suspended,
    };
  }
}
