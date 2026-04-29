import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { BlocklistService } from '../../../common/services/blocklist/blocklist.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

@Injectable()
export class StoreDomainsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly blocklist: BlocklistService,
  ) {}

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
    // Blocklist check — reject brand/financial/gov patterns
    const blockResult = await this.blocklist.isBlocked(create_domain_dto.hostname);
    if (blockResult.blocked) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_003,
        `Hostname ${create_domain_dto.hostname} is blocked: ${blockResult.reason ?? 'policy'}`,
        { hostname: create_domain_dto.hostname, pattern: blockResult.pattern },
      );
    }

    // Check for existing hostname (excluyendo terminales — pueden re-claimarse)
    const existing_domain = await this.prisma.domain_settings.findFirst({
      where: {
        hostname: create_domain_dto.hostname,
        status: { notIn: ['disabled', 'failed_ownership', 'failed_certificate', 'failed_alias'] },
      },
    });

    if (existing_domain) {
      throw new ConflictException('Domain with this hostname already exists');
    }

    const domain_type = (create_domain_dto.domain_type || 'store') as any;
    const ownership = (create_domain_dto.ownership || 'vendix_subdomain') as any;

    // Vendix subdomains: Vendix controla el DNS, activación inmediata.
    // Custom domains: SIEMPRE pending_ownership — sólo prueba DNS desbloquea active.
    const isVendixSubdomain = ownership === 'vendix_subdomain';
    const status = isVendixSubdomain ? 'active' : 'pending_ownership';

    if (status === 'active' && create_domain_dto.is_primary) {
      await this.ensureSingleActiveType(domain_type);
    }

    const tokenExpiryDays = parseInt(
      process.env.DOMAIN_TOKEN_EXPIRY_DAYS || '7',
      10,
    );
    const expires_token_at = isVendixSubdomain
      ? null
      : new Date(Date.now() + tokenExpiryDays * 24 * 60 * 60 * 1000);

    // Create domain - store_id is auto-injected by StorePrismaService
    const created = await this.prisma.domain_settings.create({
      data: {
        hostname: create_domain_dto.hostname,
        domain_type,
        is_primary: create_domain_dto.is_primary || false,
        status: status as any,
        ownership,
        config: create_domain_dto.config as any,
        expires_token_at,
      },
    });

    if (status === 'active') {
      this.eventEmitter.emit('domain.activated', {
        domainId: created.id,
        hostname: created.hostname,
        organization_id: created.organization_id,
        store_id: created.store_id,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: created.id,
        hostname: created.hostname,
      });
    }

    return created;
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
      // Sólo elevar a 'active' si la propiedad ya está probada
      // (vendix_subdomain o ya estaba activo). Custom domains en pending_*
      // deben pasar por verify() antes — no atajos vía is_primary.
      const isVendixSubdomain = existing_domain.ownership === 'vendix_subdomain';
      if (isVendixSubdomain || existing_domain.status === 'active') {
        update_data.status = 'active';
      }
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

    const updated = await this.prisma.domain_settings.update({
      where: { id },
      data: update_data,
    });

    const transitioned_to_active =
      existing_domain.status !== 'active' && updated.status === 'active';
    const transitioned_to_disabled =
      existing_domain.status !== 'disabled' && updated.status === 'disabled';

    if (transitioned_to_active) {
      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });
    } else if (transitioned_to_disabled) {
      this.eventEmitter.emit('domain.disabled', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    }

    return updated;
  }

  /**
   * Delete a domain
   */
  async remove(id: number) {
    const existing_domain = await this.findOne(id);

    if (existing_domain.is_primary) {
      throw new ConflictException('Cannot delete primary domain');
    }

    const removed = await this.prisma.domain_settings.delete({
      where: { id },
    });

    this.eventEmitter.emit('domain.disabled', {
      domainId: removed.id,
      hostname: removed.hostname,
    });

    return removed;
  }

  /**
   * Set a domain as primary for the store.
   * IMPORTANTE: sólo puede activar dominios cuya propiedad ya esté probada
   * (status active o vendix_subdomain). Custom domains en pending_ownership
   * NO pueden saltar a active vía este endpoint — deben pasar por verify().
   */
  async setAsPrimary(id: number) {
    const domain = await this.findOne(id);

    const isVendixSubdomain = domain.ownership === 'vendix_subdomain';
    if (!isVendixSubdomain && domain.status !== 'active') {
      throw new ConflictException(
        'Custom domains must be verified (DNS proof of ownership) before being set as primary',
      );
    }

    // Deactivate other domains of the same type
    await this.ensureSingleActiveType(domain.domain_type, id);

    const updated = await this.prisma.domain_settings.update({
      where: { id },
      data: {
        is_primary: true,
        status: 'active' as any,
        updated_at: new Date(),
      },
    });

    if (domain.status !== 'active') {
      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    }

    return updated;
  }
}
