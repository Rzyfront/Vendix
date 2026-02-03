import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
} from '../../organization/domains/dto/domain-settings.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class DomainsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async create(createDomainSettingDto: CreateDomainSettingDto) {
    const existingDomain = await (
      this.prisma as any
    ).domain_settings.findUnique({
      where: { hostname: createDomainSettingDto.hostname },
    });

    if (existingDomain) {
      throw new ConflictException('Domain with this hostname already exists');
    }

    return this.prisma.domain_settings.create({
      data: {
        hostname: createDomainSettingDto.hostname,
        organization_id: createDomainSettingDto.organization_id,
        store_id: createDomainSettingDto.store_id,
        domain_type: createDomainSettingDto.domain_type as any,
        config: createDomainSettingDto.config as any,
        is_primary: createDomainSettingDto.is_primary,
      },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
        store: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    domain_type?: string;
    status?: string;
    organization_id?: number;
    store_id?: number;
  }) {
    const {
      page = 1,
      limit = 10,
      search,
      domain_type,
      status,
      organization_id,
      store_id,
    } = query;
    const skip = (page - 1) * limit;
    const take = Number(limit);

    const where: Prisma.domain_settingsWhereInput = {};

    if (search) {
      where.OR = [{ hostname: { contains: search, mode: 'insensitive' } }];
    }

    if (domain_type) {
      where.domain_type = domain_type as any;
    }

    if (organization_id) {
      where.organization_id = organization_id;
    }

    if (store_id) {
      where.store_id = store_id;
    }

    const [data, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
          store: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const domain = await (this.prisma as any).domain_settings.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
        store: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    return domain;
  }

  async update(id: number, updateDomainSettingDto: UpdateDomainSettingDto) {
    const existingDomain = await (
      this.prisma as any
    ).domain_settings.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      throw new NotFoundException('Domain not found');
    }

    const { domain_type, config, is_primary, status, ssl_status, ownership } =
      updateDomainSettingDto;

    const updateData = {
      domain_type: domain_type as any,
      config: config as any,
      is_primary: is_primary ?? false,
      updated_at: new Date(),
      ...(status && { status: status as any }),
      ...(ssl_status && { ssl_status: ssl_status as any }),
      ...(ownership && { ownership: ownership as any }),
    };

    return this.prisma.domain_settings.update({
      where: { id },
      data: updateData,
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
        store: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
  }

  async remove(id: number) {
    const existingDomain = await (
      this.prisma as any
    ).domain_settings.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      throw new NotFoundException('Domain not found');
    }

    if (existingDomain.is_primary) {
      throw new ConflictException('Cannot delete primary domain');
    }

    return this.prisma.domain_settings.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalDomains,
      activeDomains,
      pendingDomains,
      verifiedDomains,
      primaryDomains,
      vendixSubdomains,
      customerSubdomains,
      customerCustomDomains,
      recentDomains,
    ] = await Promise.all([
      // Total domains
      this.prisma.domain_settings.count(),

      // Active domains (status = 'active')
      this.prisma.domain_settings.count({
        where: { status: 'active' },
      }),

      // Pending domains (status in ['pending_dns', 'pending_ssl'])
      this.prisma.domain_settings.count({
        where: {
          status: { in: ['pending_dns', 'pending_ssl'] },
        },
      }),

      // Verified domains (last_verified_at is not null)
      this.prisma.domain_settings.count({
        where: { last_verified_at: { not: null } },
      }),

      // Primary domains (is_primary = true)
      this.prisma.domain_settings.count({
        where: { is_primary: true },
      }),

      // Vendix subdomains (ownership = 'vendix_subdomain')
      this.prisma.domain_settings.count({
        where: { ownership: 'vendix_subdomain' },
      }),

      // Customer subdomains (ownership = 'custom_subdomain')
      this.prisma.domain_settings.count({
        where: { ownership: 'custom_subdomain' },
      }),

      // Customer custom domains (ownership = 'custom_domain')
      this.prisma.domain_settings.count({
        where: { ownership: 'custom_domain' },
      }),

      // Recent domains
      this.prisma.domain_settings.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          organization: {
            select: { name: true },
          },
          store: {
            select: { name: true },
          },
        },
      }),
    ]);

    // Group by type for additional info
    const domainsByType = await this.prisma.domain_settings.groupBy({
      by: ['domain_type'],
      _count: true,
    });

    const domainsByTypeReduced = domainsByType.reduce(
      (acc: Record<string, number>, item: any) => {
        acc[item.domain_type] = item._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalDomains,
      activeDomains,
      pendingDomains,
      verifiedDomains,
      customerDomains: domainsByTypeReduced['customer'] || 0,
      primaryDomains,
      aliasDomains: domainsByTypeReduced['alias'] || 0,
      vendixSubdomains,
      customerCustomDomains,
      customerSubdomains,
      domainsByType: domainsByTypeReduced,
      recentDomains,
    };
  }

  async verifyDomain(id: number) {
    const domain = await (this.prisma as any).domain_settings.findUnique({
      where: { id },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Here you would implement actual domain verification logic
    // For now, we'll just update the verification timestamp
    return this.prisma.domain_settings.update({
      where: { id },
      data: {
        last_verified_at: new Date(),
        last_error: null,
      },
    });
  }
}
