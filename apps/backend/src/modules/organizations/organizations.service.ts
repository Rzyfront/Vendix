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
  constructor(private prisma: PrismaService) {}

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

  async getDashboard(id: number, query: OrganizationDashboardDto) {
    const { start_date, end_date } = query;

    // Default last 30 days
    const startDate =
      start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end_date || new Date();

    // Base metrics
    const [
      activeUsersCount,
      activeStoresCount,
      recentOrdersCount,
      totalRevenue,
      storeActivity,
      userGrowth,
      auditActivity,
    ] = await Promise.all([
      // Active users count
      this.prisma.users.count({
        where: {
          organization_id: id,
          state: 'active',
          last_login: { gte: startDate },
        },
      }),

      // Active stores count
      this.prisma.stores.count({
        where: {
          organization_id: id,
          is_active: true,
        },
      }),

      // Recent orders count (not implemented yet, placeholder)
      this.prisma.orders.count({
        where: {
          store: { organization_id: id },
          created_at: { gte: startDate },
        },
      }),

      // Total revenue (not implemented yet, placeholder)
      this.prisma.orders.aggregate({
        where: {
          store: { organization_id: id },
          created_at: { gte: startDate },
          state: 'finished',
        },
        _sum: { grand_total: true },
      }),

      // Activity by store
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

      // User growth (new users per week)
      this.prisma.users.groupBy({
        by: ['created_at'],
        where: {
          organization_id: id,
          created_at: { gte: startDate, lte: endDate },
        },
        _count: { id: true },
        orderBy: { created_at: 'asc' },
      }),

      // Audit activity (recent actions)
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
    ]);

    return {
      organization_id: id,
      metrics: {
        active_users: activeUsersCount,
        active_stores: activeStoresCount,
        recent_orders: recentOrdersCount,
        total_revenue: totalRevenue._sum.grand_total || 0,
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
    };
  }

  async getDashboardStats(): Promise<OrganizationsDashboardStatsDto> {
    // Obtener el total de organizaciones
    const totalOrganizations = await this.prisma.organizations.count();

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
      total_organizations: totalOrganizations,
      active,
      inactive,
      suspended,
    };
  }
}
