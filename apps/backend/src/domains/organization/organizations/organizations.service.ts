import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UpdateOrganizationDto, OrganizationDashboardDto } from './dto';
import { Prisma } from '@prisma/client';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: OrganizationPrismaService,
    private s3Service: S3Service,
  ) { }

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
      logo_url: await this.s3Service.signUrl(organization.logo_url),
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
      logo_url: await this.s3Service.signUrl(updated.logo_url),
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
}
