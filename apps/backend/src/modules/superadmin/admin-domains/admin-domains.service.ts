import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
} from 'src/modules/domains/dto/domain-settings.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminDomainsService {
  constructor(private prisma: PrismaService) {}

  async create(createDomainSettingDto: CreateDomainSettingDto) {
    const existingDomain = await (
      this.prisma.withoutScope() as any
    ).domain_settings.findUnique({
      where: { hostname: createDomainSettingDto.hostname },
    });

    if (existingDomain) {
      throw new ConflictException('Domain with this hostname already exists');
    }

    return (this.prisma.withoutScope() as any).domain_settings.create({
      data: {
        hostname: createDomainSettingDto.hostname,
        organization_id: createDomainSettingDto.organization_id,
        store_id: createDomainSettingDto.store_id,
        domain_type: createDomainSettingDto.domain_type as any,
        config: createDomainSettingDto.config,
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
      (this.prisma.withoutScope() as any).domain_settings.findMany({
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
      (this.prisma.withoutScope() as any).domain_settings.count({ where }),
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
    const domain = await (
      this.prisma.withoutScope() as any
    ).domain_settings.findUnique({
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
      this.prisma.withoutScope() as any
    ).domain_settings.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      throw new NotFoundException('Domain not found');
    }

    return (this.prisma.withoutScope() as any).domain_settings.update({
      where: { id },
      data: {
        ...updateDomainSettingDto,
        domain_type: updateDomainSettingDto.domain_type as any,
        config: updateDomainSettingDto.config,
        is_primary: updateDomainSettingDto.is_primary,
        updated_at: new Date(),
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

  async remove(id: number) {
    const existingDomain = await (
      this.prisma.withoutScope() as any
    ).domain_settings.findUnique({
      where: { id },
    });

    if (!existingDomain) {
      throw new NotFoundException('Domain not found');
    }

    if (existingDomain.is_primary) {
      throw new ConflictException('Cannot delete primary domain');
    }

    return (this.prisma.withoutScope() as any).domain_settings.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalDomains,
      activeDomains,
      domainsByType,
      domainsByOwnership,
      recentDomains,
    ] = await Promise.all([
      (this.prisma.withoutScope() as any).domain_settings.count(),
      (this.prisma.withoutScope() as any).domain_settings.count({
        where: {
          OR: [{ last_verified_at: { not: null } }, { last_error: null }],
        },
      }),
      (this.prisma.withoutScope() as any).domain_settings.groupBy({
        by: ['domain_type'],
        _count: true,
      }),
      (this.prisma.withoutScope() as any).domain_settings.groupBy({
        by: ['domain_type'],
        _count: true,
      }),
      (this.prisma.withoutScope() as any).domain_settings.findMany({
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

    return {
      totalDomains,
      activeDomains,
      domainsByType: domainsByType.reduce(
        (acc, item) => {
          acc[item.domain_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      domainsByOwnership: domainsByOwnership.reduce(
        (acc, item) => {
          acc[item.domain_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentDomains,
    };
  }

  async verifyDomain(id: number) {
    const domain = await (
      this.prisma.withoutScope() as any
    ).domain_settings.findUnique({
      where: { id },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Here you would implement actual domain verification logic
    // For now, we'll just update the verification timestamp
    return (this.prisma.withoutScope() as any).domain_settings.update({
      where: { id },
      data: {
        last_verified_at: new Date(),
        last_error: null,
      },
    });
  }
}
