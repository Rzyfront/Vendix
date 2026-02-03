import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  UpdateOrganizationDto,
  OrganizationDashboardDto,
  UpgradeAccountTypeDto,
  OrganizationAccountType,
} from './dto';
import { Prisma } from '@prisma/client';
import { S3Service } from '@common/services/s3.service';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: OrganizationPrismaService,
    private globalPrisma: GlobalPrismaService,
    private s3Service: S3Service,
    private defaultPanelUIService: DefaultPanelUIService,
  ) {}

  async getProfile() {
    // Obtener organization_id del contexto del usuario
    const context = RequestContextService.getContext();

    if (!context?.organization_id) {
      throw new NotFoundException('Organization context not found');
    }

    const organization = await this.prisma.organizations.findUnique({
      where: { id: context.organization_id },
      include: {
        addresses: { where: { is_primary: true } },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return {
      ...organization,
      logo_url: await this.s3Service.signUrl((organization as any).logo_url),
    };
  }

  async updateProfile(updateOrganizationDto: UpdateOrganizationDto) {
    // Obtener organization_id del contexto del usuario
    const context = RequestContextService.getContext();

    if (!context?.organization_id) {
      throw new NotFoundException('Organization context not found');
    }

    const updated = await this.prisma.organizations.update({
      where: { id: context.organization_id },
      data: { ...updateOrganizationDto, updated_at: new Date() },
      include: {
        addresses: { where: { is_primary: true } },
      },
    });

    return {
      ...updated,
      logo_url: await this.s3Service.signUrl((updated as any).logo_url),
    };
  }

  async getDashboard(query: OrganizationDashboardDto) {
    const { store_id } = query;

    // Obtener organization_id del contexto del usuario
    const context = RequestContextService.getContext();

    if (!context?.organization_id) {
      throw new NotFoundException('Organization context not found');
    }

    const org_id = context.organization_id;

    // Dates setup
    const now = new Date();
    const today_start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const current_month_start = new Date(now.getFullYear(), now.getMonth(), 1);
    const last_month_start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last_month_end = new Date(now.getFullYear(), now.getMonth(), 0);

    // Usar el store_id opcional para filtrar por tienda específica
    const store_filter = store_id ? { store_id: Number(store_id) } : {};

    const [
      // 1. Total Stores & New this month
      total_stores,
      new_stores_this_month,

      // 2. Active Users
      active_users,

      // 3. Monthly Orders & Orders today
      monthly_orders,
      orders_today,

      // 4. Revenue (Current Month) & Last Month
      revenue_current_month,
      revenue_last_month,
    ] = await Promise.all([
      // Total Stores
      this.prisma.stores.count({
        where: { organization_id: org_id, is_active: true },
      }),

      // New stores this month
      this.prisma.stores.count({
        where: {
          organization_id: org_id,
          is_active: true,
          created_at: { gte: current_month_start },
        },
      }),

      // Active Users
      this.prisma.users.count({
        where: {
          organization_id: org_id,
          state: 'active',
        },
      }),

      // Monthly Orders
      this.prisma.orders.count({
        where: {
          stores: {
            organization_id: org_id,
            ...(store_id && { id: Number(store_id) }),
          },
          created_at: { gte: current_month_start },
          state: 'finished',
        },
      }),

      // Orders today
      this.prisma.orders.count({
        where: {
          stores: {
            organization_id: org_id,
            ...(store_id && { id: Number(store_id) }),
          },
          created_at: { gte: today_start },
          state: 'finished',
        },
      }),

      // Revenue Current Month (Profit)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: {
              organization_id: org_id,
              ...(store_id && { id: Number(store_id) }),
            },
            created_at: { gte: current_month_start },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: {
                organization_id: org_id,
                ...(store_id && { id: Number(store_id) }),
              },
              created_at: { gte: current_month_start },
              state: 'finished',
            },
          },
          _sum: { total_price: true },
        }),
      ]).then(([revenue_res, cost_res]) => {
        const revenue = Number(revenue_res._sum.grand_total || 0);
        const shipping_cost = Number(revenue_res._sum.shipping_cost || 0);
        const cogs = Number(cost_res._sum.total_price || 0);
        return { _sum: { profit: revenue - shipping_cost - cogs } };
      }),

      // Profit Last Month (Revenue - Costs)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: {
              organization_id: org_id,
              ...(store_id && { id: Number(store_id) }),
            },
            created_at: { gte: last_month_start, lte: last_month_end },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: {
                organization_id: org_id,
                ...(store_id && { id: Number(store_id) }),
              },
              created_at: { gte: last_month_start, lte: last_month_end },
              state: 'finished',
            },
          },
          _sum: { total_price: true },
        }),
      ]).then(([revenue_res, cost_res]) => {
        const revenue = Number(revenue_res._sum.grand_total || 0);
        const shipping_cost = Number(revenue_res._sum.shipping_cost || 0);
        const cogs = Number(cost_res._sum.total_price || 0);
        return { _sum: { profit: revenue - shipping_cost - cogs } };
      }),
    ]);

    const current_rev = Number(revenue_current_month._sum.profit || 0);
    const last_rev = Number(revenue_last_month._sum.profit || 0);
    const revenue_diff = current_rev - last_rev;

    return {
      organization_id: org_id,
      store_filter: store_id,
      stats: {
        total_stores: {
          value: total_stores,
          sub_value: new_stores_this_month,
          sub_label: 'new this month',
        },
        active_users: {
          value: active_users,
          sub_value: null,
          sub_label: 'active users',
        },
        monthly_orders: {
          value: monthly_orders,
          sub_value: orders_today,
          sub_label: 'orders today',
        },
        revenue: {
          value: current_rev,
          sub_value: revenue_diff,
          sub_label: 'vs last month',
        },
      },
    };
  }

  async getOrganizationStats(
    organizationId: number,
    query: OrganizationDashboardDto,
  ) {
    const { period } = query;

    // Validate organization exists
    const organization = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const org_id = organizationId;

    // Dates setup
    const now = new Date();
    const today_start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const current_month_start = new Date(now.getFullYear(), now.getMonth(), 1);
    const last_month_start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last_month_end = new Date(now.getFullYear(), now.getMonth(), 0);

    // Calculate period dates for profit trend
    const monthsMap: Record<string, number> = { '6m': 6, '1y': 12, 'all': 24 };
    const monthsToFetch = period && monthsMap[period] ? monthsMap[period] : 6;
    const trend_start_date = new Date(
      now.getFullYear(),
      now.getMonth() - (monthsToFetch - 1),
      1,
    );

    const [
      // 1. Total Stores & New this month
      total_stores,
      new_stores_this_month,

      // 2. Active Users (online now - using last_seen)
      active_users,
      online_users,

      // 3. Monthly Orders & Orders today
      monthly_orders,
      orders_today,

      // 4. Revenue (Current Month) & Last Month
      revenue_current_month,
      revenue_last_month,

      // 5. Profit Trend
      profit_trend_raw,

      // 6. Store Distribution (by type/sales_channel)
      store_distribution_raw,
    ] = await Promise.all([
      // Total Stores
      this.prisma.stores.count({
        where: { organization_id: org_id, is_active: true },
      }),

      // New stores this month
      this.prisma.stores.count({
        where: {
          organization_id: org_id,
          is_active: true,
          created_at: { gte: current_month_start },
        },
      }),

      // Active Users
      this.prisma.users.count({
        where: {
          organization_id: org_id,
          state: 'active',
        },
      }),

      // Online Users (count active sessions in last 15 minutes)
      // Note: using user_sessions for more accurate online status
      this.globalPrisma.user_sessions.count({
        where: {
          users: {
            organization_id: org_id,
            state: 'active',
          },
          expires_at: { gt: new Date() },
          created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      }),

      // Monthly Orders
      this.prisma.orders.count({
        where: {
          stores: { organization_id: org_id },
          created_at: { gte: current_month_start },
          state: { not: 'cancelled' },
        },
      }),

      // Orders today
      this.prisma.orders.count({
        where: {
          stores: { organization_id: org_id },
          created_at: { gte: today_start },
          state: { not: 'cancelled' },
        },
      }),

      // Revenue Current Month (Profit)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: { organization_id: org_id },
            created_at: { gte: current_month_start },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: { organization_id: org_id },
              created_at: { gte: current_month_start },
              state: 'finished',
            },
          },
          _sum: { total_price: true },
        }),
      ]).then(([revenue_res, cost_res]) => {
        const revenue = Number(revenue_res._sum.grand_total || 0);
        const shipping_cost = Number(revenue_res._sum.shipping_cost || 0);
        const cogs = Number(cost_res._sum.total_price || 0);
        return { _sum: { profit: revenue - shipping_cost - cogs } };
      }),

      // Profit Last Month (Revenue - Costs)
      Promise.all([
        this.prisma.orders.aggregate({
          where: {
            stores: { organization_id: org_id },
            created_at: { gte: last_month_start, lte: last_month_end },
            state: 'finished',
          },
          _sum: { grand_total: true, shipping_cost: true },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              stores: { organization_id: org_id },
              created_at: { gte: last_month_start, lte: last_month_end },
              state: 'finished',
            },
          },
          _sum: { total_price: true },
        }),
      ]).then(([revenue_res, cost_res]) => {
        const revenue = Number(revenue_res._sum.grand_total || 0);
        const shipping_cost = Number(revenue_res._sum.shipping_cost || 0);
        const cogs = Number(cost_res._sum.total_price || 0);
        return { _sum: { profit: revenue - shipping_cost - cogs } };
      }),

      // Profit Trend - monthly aggregates
      (this.prisma.withoutScope() as any).$queryRaw<Array<{
        month: number;
        year: number;
        revenue: bigint;
        costs: bigint;
      }>>`
        WITH monthly_orders AS (
          SELECT
            EXTRACT(MONTH FROM o.created_at)::int as month,
            EXTRACT(YEAR FROM o.created_at)::int as year,
            COALESCE(SUM(o.grand_total - o.shipping_cost), 0) as revenue
          FROM orders o
          INNER JOIN stores s ON s.id = o.store_id
          WHERE s.organization_id = ${org_id}
            AND o.state = 'finished'
            AND o.created_at >= ${trend_start_date}
          GROUP BY EXTRACT(MONTH FROM o.created_at), EXTRACT(YEAR FROM o.created_at)
        ),
        monthly_costs AS (
          SELECT
            EXTRACT(MONTH FROM o.created_at)::int as month,
            EXTRACT(YEAR FROM o.created_at)::int as year,
            COALESCE(SUM(oi.total_price), 0) as costs
          FROM order_items oi
          INNER JOIN orders o ON oi.order_id = o.id
          INNER JOIN stores s ON s.id = o.store_id
          WHERE s.organization_id = ${org_id}
            AND o.state = 'finished'
            AND o.created_at >= ${trend_start_date}
          GROUP BY EXTRACT(MONTH FROM o.created_at), EXTRACT(YEAR FROM o.created_at)
        )
        SELECT
          mo.month,
          mo.year,
          mo.revenue,
          COALESCE(mc.costs, 0) as costs
        FROM monthly_orders mo
        LEFT JOIN monthly_costs mc ON mo.month = mc.month AND mo.year = mc.year
        ORDER BY mo.year, mo.month
      `,

      // Store Distribution by store type (online vs physical)
      (this.prisma.withoutScope() as any).$queryRaw<Array<{ type: string; revenue: bigint }>>`
        SELECT
          s.store_type as type,
          COALESCE(SUM(o.grand_total), 0) as revenue
        FROM stores s
        LEFT JOIN orders o ON o.store_id = s.id AND o.state = 'finished'
          AND o.created_at >= ${current_month_start}
        WHERE s.organization_id = ${org_id} AND s.is_active = true
        GROUP BY s.store_type
      `,
    ]);

    const current_rev = Number(revenue_current_month._sum.profit || 0);
    const last_rev = Number(revenue_last_month._sum.profit || 0);
    const revenue_diff = current_rev - last_rev;

    // Format profit trend
    const monthNames = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    const profit_trend = (profit_trend_raw || []).map((item: any) => ({
      month: monthNames[item.month - 1] || 'Mes',
      year: item.year,
      amount: Number(item.revenue) - Number(item.costs),
      revenue: Number(item.revenue),
      costs: Number(item.costs),
    }));

    // Format store distribution - group by online vs offline
    const typeMapping: Record<string, string> = {
      online: 'online',
      hybrid: 'online',
      physical: 'offline',
      popup: 'offline',
      kiosko: 'offline',
    };

    const distributionMap = new Map<string, number>();
    (store_distribution_raw || []).forEach((item: any) => {
      const groupedType = typeMapping[item.type] || item.type;
      const currentRevenue = distributionMap.get(groupedType) || 0;
      distributionMap.set(groupedType, currentRevenue + Number(item.revenue));
    });

    const store_distribution = Array.from(distributionMap.entries()).map(
      ([type, revenue]) => ({
        type,
        count: 0,
        revenue,
      }),
    );

    return {
      organization_id: org_id,
      stats: {
        total_stores: {
          value: total_stores,
          sub_value: new_stores_this_month,
          sub_label: 'new this month',
        },
        active_users: {
          value: active_users,
          sub_value: online_users,
          sub_label: 'online now',
        },
        monthly_orders: {
          value: monthly_orders,
          sub_value: orders_today,
          sub_label: 'orders today',
        },
        revenue: {
          value: current_rev,
          sub_value: revenue_diff,
          sub_label: 'vs last month',
        },
      },
      profit_trend,
      store_distribution,
    };
  }

  /**
   * Upgrade organization account type from SINGLE_STORE to MULTI_STORE_ORG
   * Only owners can perform this action
   */
  async upgradeAccountType(dto: UpgradeAccountTypeDto) {
    const context = RequestContextService.getContext();

    if (!context?.organization_id || !context?.user_id) {
      throw new NotFoundException('Context not found');
    }

    // Get user with roles to validate owner status
    const user = await this.globalPrisma.users.findUnique({
      where: { id: context.user_id },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        organizations: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate that user is owner
    const isOwner = user.user_roles?.some((ur) => ur.roles?.name === 'owner');
    if (!isOwner) {
      throw new ForbiddenException(
        'Solo los owners pueden cambiar el tipo de cuenta.',
      );
    }

    // Validate that organization is not already MULTI_STORE_ORG
    if (user.organizations?.account_type === 'MULTI_STORE_ORG') {
      throw new BadRequestException(
        'Tu cuenta ya es una organización multi-tienda.',
      );
    }

    // Update account_type to MULTI_STORE_ORG
    const org = await this.prisma.organizations.update({
      where: { id: context.organization_id },
      data: {
        account_type: 'MULTI_STORE_ORG',
        updated_at: new Date(),
      },
    });

    // Get current user_settings
    const userSettings = await this.globalPrisma.user_settings.findUnique({
      where: { user_id: context.user_id },
    });

    if (userSettings) {
      // Generate ORG_ADMIN config using DefaultPanelUIService
      const generatedConfig =
        await this.defaultPanelUIService.generatePanelUI('ORG_ADMIN');
      const orgAdminPanelUi = generatedConfig.panel_ui?.ORG_ADMIN || {};

      const currentConfig = (userSettings.config as any) || {};
      const currentPanelUi = currentConfig.panel_ui || {};

      // Add ORG_ADMIN to panel_ui if not present
      await this.globalPrisma.user_settings.update({
        where: { id: userSettings.id },
        data: {
          config: {
            ...currentConfig,
            panel_ui: {
              ...currentPanelUi,
              ORG_ADMIN: orgAdminPanelUi,
            },
          },
          updated_at: new Date(),
        },
      });
    }

    return {
      account_type: org.account_type,
      message:
        'Tu cuenta ha sido actualizada a organización multi-tienda. Ahora puedes cambiar al entorno de organización.',
    };
  }
}
