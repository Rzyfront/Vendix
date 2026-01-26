import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class StoreDomainsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Create a new domain for the current store
   */
  async create(create_domain_dto: {
    hostname: string;
    domain_type?: string;
    is_primary?: boolean;
    ownership?: string;
    config: Record<string, any>;
  }) {
    // Check for existing hostname
    const existing_domain = await this.prisma.domain_settings.findFirst({
      where: { hostname: create_domain_dto.hostname },
    });

    if (existing_domain) {
      throw new ConflictException('Domain with this hostname already exists');
    }

    const domain_type = (create_domain_dto.domain_type || 'store') as any;

    // Ensure only one active domain per type
    if (create_domain_dto.is_primary) {
      await this.ensureSingleActiveType(domain_type);
    }

    // Create domain - store_id is auto-injected by StorePrismaService
    return this.prisma.domain_settings.create({
      data: {
        hostname: create_domain_dto.hostname,
        domain_type,
        is_primary: create_domain_dto.is_primary || false,
        status: create_domain_dto.is_primary ? 'active' : 'pending_dns',
        ownership: (create_domain_dto.ownership || 'vendix_subdomain') as any,
        config: create_domain_dto.config as any,
      },
    });
  }

  private async ensureSingleActiveType(domain_type: any, exclude_id?: number) {
    // Find existing active domains of the same type and deactivate them
    await this.prisma.domain_settings.updateMany({
      where: {
        domain_type,
        status: 'active',
        id: exclude_id ? { not: exclude_id } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Get all domains for the current store with pagination
   */
  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    domain_type?: string;
    status?: string;
  }) {
    const { page = 1, limit = 10, search, domain_type, status } = query;
    const skip = (page - 1) * limit;
    const take = Number(limit);

    const where: Prisma.domain_settingsWhereInput = {};

    if (search) {
      where.OR = [{ hostname: { contains: search, mode: 'insensitive' } }];
    }

    if (domain_type) {
      where.domain_type = domain_type as any;
    }

    if (status) {
      where.status = status as any;
    }

    // store_id filter is auto-applied by StorePrismaService
    const [data, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take,
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
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single domain by ID
   */
  async findOne(id: number) {
    const domain = await this.prisma.domain_settings.findFirst({
      where: { id },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    return domain;
  }

  /**
   * Update a domain
   */
  async update(
    id: number,
    update_domain_dto: {
      domain_type?: string;
      is_primary?: boolean;
      status?: string;
      ssl_status?: string;
      ownership?: string;
      config?: Record<string, any>;
    },
  ) {
    const existing_domain = await this.findOne(id);

    const update_data: any = {
      updated_at: new Date(),
    };

    const domain_type =
      update_domain_dto.domain_type || existing_domain.domain_type;

    if (update_domain_dto.domain_type !== undefined) {
      update_data.domain_type = update_domain_dto.domain_type as any;
    }

    if (update_domain_dto.status === 'active') {
      await this.ensureSingleActiveType(domain_type, id);
    }

    if (update_domain_dto.is_primary === true) {
      update_data.is_primary = true;
      update_data.status = 'active';
      await this.ensureSingleActiveType(domain_type, id);
    } else if (update_domain_dto.is_primary === false) {
      update_data.is_primary = false;
    }

    if (update_domain_dto.status !== undefined) {
      update_data.status = update_domain_dto.status as any;
    }

    if (update_domain_dto.ssl_status !== undefined) {
      update_data.ssl_status = update_domain_dto.ssl_status as any;
    }

    if (update_domain_dto.ownership !== undefined) {
      update_data.ownership = update_domain_dto.ownership as any;
    }

    if (update_domain_dto.config !== undefined) {
      update_data.config = update_domain_dto.config as any;
    }

    return this.prisma.domain_settings.update({
      where: { id },
      data: update_data,
    });
  }

  /**
   * Delete a domain
   */
  async remove(id: number) {
    const existing_domain = await this.findOne(id);

    if (existing_domain.is_primary) {
      throw new ConflictException('Cannot delete primary domain');
    }

    return this.prisma.domain_settings.delete({
      where: { id },
    });
  }

  /**
   * Set a domain as primary for the store
   */
  async setAsPrimary(id: number) {
    const domain = await this.findOne(id);

    // Deactivate other domains of the same type
    await this.ensureSingleActiveType(domain.domain_type, id);

    // Set new primary domain and ensure it's active
    return this.prisma.domain_settings.update({
      where: { id },
      data: {
        is_primary: true,
        status: 'active',
        updated_at: new Date(),
      },
    });
  }
}
