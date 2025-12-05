import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  AdminOrganizationQueryDto,
  OrganizationState,
  OrganizationDashboardDto,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

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

  async findAll(query: AdminOrganizationQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;
    const skip = (page - 1) * Number(limit);

    const where: Prisma.organizationsWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { tax_id: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.state = status;
    }

    if (is_active !== undefined) {
      where.state = is_active
        ? OrganizationState.ACTIVE
        : OrganizationState.INACTIVE;
    }

    const [data, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: {
            select: { id: true, name: true, is_active: true },
          },
          _count: {
            select: {
              users: true,
              stores: true,
            },
          },
        },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const organization = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        stores: {
          include: {
            addresses: true,
            _count: {
              select: {
                store_users: true,
                orders: true,
                products: true,
              },
            },
          },
        },
        addresses: true,
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            state: true,
            user_roles: {
              include: {
                roles: true,
              },
            },
          },
        },
        _count: {
          select: {
            stores: true,
            users: true,
            addresses: true,
          },
        },
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
      include: {
        stores: true,
        addresses: true,
        users: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async update(id: number, updateOrganizationDto: UpdateOrganizationDto) {
    const existingOrg = await this.prisma.organizations.findUnique({
      where: { id },
    });

    if (!existingOrg) {
      throw new NotFoundException('Organization not found');
    }

    let slug = existingOrg.slug;
    if (
      updateOrganizationDto.name &&
      updateOrganizationDto.name !== existingOrg.name
    ) {
      slug = slugify(updateOrganizationDto.name, {
        lower: true,
        strict: true,
      });

      const slugExists = await this.prisma.organizations.findFirst({
        where: { slug, id: { not: id } },
      });

      if (slugExists) {
        throw new ConflictException(
          'Organization with this slug already exists',
        );
      }
    }

    if (
      updateOrganizationDto.tax_id &&
      updateOrganizationDto.tax_id !== existingOrg.tax_id
    ) {
      const taxIdExists = await this.prisma.organizations.findFirst({
        where: { tax_id: updateOrganizationDto.tax_id, id: { not: id } },
      });

      if (taxIdExists) {
        throw new ConflictException(
          'Organization with this tax ID already exists',
        );
      }
    }

    return this.prisma.organizations.update({
      where: { id },
      data: {
        ...updateOrganizationDto,
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

  async remove(id: number) {
    const existingOrg = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            stores: true,
            users: true,
          },
        },
      },
    });

    if (!existingOrg) {
      throw new NotFoundException('Organization not found');
    }

    if (existingOrg._count.stores > 0 || existingOrg._count.users > 0) {
      throw new BadRequestException(
        'Cannot delete organization with existing stores or users',
      );
    }

    return this.prisma.organizations.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalOrganizations,
      activeOrganizations,
      inactiveOrganizations,
      recentOrganizations,
      organizationsByStatus,
    ] = await Promise.all([
      this.prisma.organizations.count(),
      this.prisma.organizations.count({ where: { state: 'active' } }),
      this.prisma.organizations.count({ where: { state: 'inactive' } }),
      this.prisma.organizations.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          created_at: true,
          _count: {
            select: {
              stores: true,
              users: true,
            },
          },
        },
      }),
      this.prisma.organizations.groupBy({
        by: ['state'],
        _count: true,
      }),
    ]);

    return {
      totalOrganizations,
      activeOrganizations,
      inactiveOrganizations,
      recentOrganizations,
      organizationsByStatus: organizationsByStatus.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item.state] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  async getDashboard(id: number, query: OrganizationDashboardDto) {
    const { start_date, end_date } = query;

    const organization = await this.findOne(id);

    const dateFilter: Prisma.ordersWhereInput = {};
    if (start_date || end_date) {
      dateFilter.created_at = {};
      if (start_date) dateFilter.created_at.gte = new Date(start_date);
      if (end_date) dateFilter.created_at.lte = new Date(end_date);
    }

    const [
      totalStores,
      activeStores,
      totalUsers,
      activeUsers,
      totalOrders,
      totalRevenue,
      recentOrders,
      topStores,
    ] = await Promise.all([
      this.prisma.stores.count({
        where: { organization_id: id },
      }),
      this.prisma.stores.count({
        where: { organization_id: id, is_active: true },
      }),
      this.prisma.users.count({
        where: { organization_id: id },
      }),
      this.prisma.users.count({
        where: { organization_id: id, state: 'active' },
      }),
      this.prisma.orders.count({
        where: { stores: { organization_id: id }, ...dateFilter },
      }),
      this.prisma.orders.aggregate({
        where: { stores: { organization_id: id }, ...dateFilter },
        _sum: { grand_total: true },
      }),
      this.prisma.orders.findMany({
        where: { stores: { organization_id: id } },
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          stores: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.stores.findMany({
        where: { organization_id: id },
        take: 5,
        orderBy: {
          orders: {
            _count: 'desc',
          },
        },
        include: {
          _count: {
            select: {
              orders: true,
              store_users: true,
              products: true,
            },
          },
        },
      }),
    ]);

    return {
      organization,
      stats: {
        totalStores,
        activeStores,
        totalUsers,
        activeUsers,
        totalOrders,
        totalRevenue: Number(totalRevenue._sum.grand_total) || 0,
      },
      recentOrders,
      topStores,
    };
  }
}
