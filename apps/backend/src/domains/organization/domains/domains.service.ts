import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import * as dns from 'node:dns/promises';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from './dto/domain-settings.dto';

interface DomainStats {
  total: number;
  active: number;
  pending: number;
  verified: number;
  platformSubdomains: number;
  customDomains: number;
  clientSubdomains: number;
  aliasDomains: number;
}

@Injectable()
export class DomainsService implements OnModuleInit {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private prisma: OrganizationPrismaService,
    private eventEmitter: EventEmitter2,
  ) { }

  async onModuleInit() { }

  // ==================== VALIDATION METHODS ====================

  private validateHostnameFormat(hostname: string): void {
    // Basic hostname validation
    const hostname_regex =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!hostname_regex.test(hostname)) {
      throw new BadRequestException('Invalid hostname format');
    }

    // Check for reserved subdomains
    const reserved = ['www', 'api', 'admin', 'app', 'mail', 'ftp', 'localhost'];
    const parts = hostname.split('.');
    if (parts.length > 1 && reserved.includes(parts[0].toLowerCase())) {
      throw new BadRequestException('Reserved subdomain not allowed');
    }
  }

  private inferDomainType(
    hostname: string,
    hasStore: boolean,
    provided?: string,
  ): string {
    if (provided) return provided;

    // If has store, it's store-specific
    if (hasStore) return 'store_domain';

    // Check if it's a subdomain
    const parts = hostname.split('.');
    if (parts.length > 2) return 'subdomain';

    return 'primary_domain';
  }

  private inferOwnership(
    hostname: string,
    domainType: string,
    provided?: string,
  ): string {
    if (provided) return provided;

    // Platform subdomains
    if (hostname.includes('vendix')) return 'vendix_subdomain';

    // Custom domains
    if (domainType === 'primary_domain') return 'custom_domain';

    // Subdomains
    return 'custom_subdomain';
  }

  // ==================== PRIMARY DOMAIN MANAGEMENT ====================

  private async clearExistingPrimary(
    orgId: number | undefined,
    storeId: number | undefined,
    domainType: string,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        store_id: storeId || null,
        domain_type: domainType as any,
        is_primary: true,
      },
      data: { is_primary: false },
    });
  }

  private generateVerificationToken(): string {
    return (
      'vdx_' +
      Math.random().toString(36).substring(2, 12) +
      Date.now().toString(36)
    );
  }

  // ==================== ESTADÍSTICAS DE DOMINIOS ====================

  async getDomainStats(organizationId?: number): Promise<DomainStats> {
    // Build where clause to filter by organization
    const where: any = {};

    if (organizationId) {
      where.OR = [
        // Direct organization domains
        { organization_id: organizationId },
        // Store domains where the store belongs to this organization
        {
          store: {
            organization_id: organizationId,
          },
        },
      ];
    }

    // Obtener todos los dominios con sus estados
    const domains = await this.prisma.domain_settings.findMany({
      where,
      select: {
        status: true,
        ssl_status: true,
        ownership: true,
        domain_type: true,
        last_verified_at: true,
      },
    });

    // Calcular estadísticas
    const stats: DomainStats = {
      total: domains.length,
      active: 0,
      pending: 0,
      verified: 0,
      platformSubdomains: 0,
      customDomains: 0,
      clientSubdomains: 0,
      aliasDomains: 0,
    };

    domains.forEach((domain) => {
      // Estadísticas por estado
      if (domain.status === 'active') {
        stats.active++;
      } else if (
        domain.status === 'pending_dns' ||
        domain.status === 'pending_ssl'
      ) {
        stats.pending++;
      }

      // Estadísticas de verificación (SSL)
      if (domain.ssl_status === 'issued' || domain.last_verified_at) {
        stats.verified++;
      }

      // Estadísticas por ownership
      switch (domain.ownership) {
        case 'vendix_subdomain':
          stats.platformSubdomains++;
          break;
        case 'custom_domain':
          stats.customDomains++;
          break;
        case 'custom_subdomain':
          stats.clientSubdomains++;
          break;
        case 'third_party_subdomain':
          stats.aliasDomains++;
          break;
        case 'vendix_core':
          stats.platformSubdomains++;
          break;
      }
    });

    return stats;
  }

  // ==================== DOMAIN RESOLUTION ====================

  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ) {
    // Implementation for domain resolution
    const domain = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: true,
        store: true,
      },
    });

    if (!domain) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    return {
      id: domain.id,
      hostname: domain.hostname,
      organization_id: domain.organization_id,
      store_id: domain.store_id,
      config: domain.config,
      created_at: domain.created_at.toISOString(),
      updated_at: domain.updated_at.toISOString(),
      store_name: domain.store_id ? 'Store Name' : undefined, // Would need to join stores table
      store_slug: domain.store_id ? 'store-slug' : undefined,
      organization_name: domain.organization?.name,
      organization_slug: domain.organization?.slug,
      domain_type: domain.domain_type,
      status: domain.status,
      ssl_status: domain.ssl_status,
      is_primary: domain.is_primary,
      ownership: domain.ownership,
    };
  }

  async checkHostnameAvailability(hostname: string) {
    const existing = await this.prisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      available: !existing,
      reason: existing ? 'Hostname already exists' : undefined,
    };
  }

  // ==================== CRUD OPERATIONS ====================

  async createDomainSetting(data: CreateDomainSettingDto) {
    // Validate hostname
    this.validateHostnameFormat(data.hostname);

    // Check if hostname already exists
    const existing = await this.prisma.domain_settings.findUnique({
      where: { hostname: data.hostname },
    });

    if (existing) {
      throw new ConflictException(`Domain ${data.hostname} already exists`);
    }

    // Infer domain type and ownership
    const inferred_type = this.inferDomainType(
      data.hostname,
      !!data.store_id,
      data.domain_type,
    );
    const inferred_ownership = this.inferOwnership(
      data.hostname,
      inferred_type,
      data.ownership,
    );

    // Handle primary domain logic and status
    const is_primary = data.is_primary || false;

    // Vendix subdomains are automatically active (no DNS verification needed)
    // Primary domains are also set to active
    const isVendixSubdomain = inferred_ownership === 'vendix_subdomain';
    const status =
      isVendixSubdomain || is_primary ? ('active' as any) : ('pending_dns' as any);

    if (is_primary || status === 'active') {
      await this.ensureSingleActiveType(
        data.organization_id,
        data.store_id,
        inferred_type,
      );
    }

    // Generate verification token
    const verification_token = this.generateVerificationToken();

    // Vendix subdomains have SSL automatically issued (managed by Vendix)
    const ssl_status = isVendixSubdomain ? ('issued' as any) : ('pending' as any);

    // Create domain setting
    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        ...(data.organization_id && { organization_id: data.organization_id }),
        store_id: data.store_id,
        config: data.config as any,
        domain_type: inferred_type as any,
        status,
        ssl_status,
        is_primary,
        ownership: inferred_ownership as any,
        verification_token: verification_token,
        updated_at: new Date(),
      },
    });

    return domainSetting;
  }

  private async ensureSingleActiveType(
    organizationId: number | undefined,
    storeId: number | undefined,
    domainType: string,
    excludeId?: number,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        organization_id: organizationId || null,
        store_id: storeId || null,
        domain_type: domainType as any,
        status: 'active',
        id: excludeId ? { not: excludeId } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }

  async getAllDomainSettings(filters: any) {
    const { page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by organization_id - includes org domains AND store domains
    if (filters.organization_id) {
      where.OR = [
        // Direct organization domains
        { organization_id: filters.organization_id },
        // Store domains where the store belongs to this organization
        {
          store: {
            organization_id: filters.organization_id,
          },
        },
      ];
    }

    // Filter by specific store (can be combined with organization filter)
    if (filters.store_id) {
      if (where.OR) {
        // If we already have organization filter, add store filter as AND condition
        where.AND = [{ store_id: filters.store_id }];
      } else {
        where.store_id = filters.store_id;
      }
    }

    if (filters.search) {
      const searchCondition = {
        hostname: { contains: filters.search, mode: 'insensitive' as const },
      };
      if (where.OR || where.AND) {
        where.AND = [...(where.AND || []), searchCondition];
      } else {
        where.hostname = searchCondition.hostname;
      }
    }

    if (filters.status) {
      const statusCondition = { status: filters.status };
      if (where.OR || where.AND) {
        where.AND = [...(where.AND || []), statusCondition];
      } else {
        where.status = filters.status;
      }
    }

    if (filters.ownership) {
      const ownershipCondition = { ownership: filters.ownership };
      if (where.OR || where.AND) {
        where.AND = [...(where.AND || []), ownershipCondition];
      } else {
        where.ownership = filters.ownership;
      }
    }

    const [domain_settings, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
          store: {
            select: { id: true, name: true, slug: true, organization_id: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data: domain_settings,
      total,
      limit,
      offset: skip,
    };
  }

  async getDomainSettingByHostname(hostname: string) {
    const domain_setting = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: true,
      },
    });

    if (!domain_setting) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    return domain_setting;
  }

  async getDomainSettingById(id: number) {
    const domain_setting = await this.prisma.domain_settings.findUnique({
      where: { id },
      include: {
        organization: true,
      },
    });

    if (!domain_setting) {
      throw new NotFoundException(`Domain with ID ${id} not found`);
    }

    return domain_setting;
  }

  async updateDomainSetting(
    hostname: string,
    updateData: UpdateDomainSettingDto,
  ) {
    const existing_record = await this.getDomainSettingByHostname(hostname);

    const domain_type = updateData.domain_type || existing_record.domain_type;

    // Handle activation logic
    if (updateData.status === 'active' || updateData.is_primary === true) {
      await this.ensureSingleActiveType(
        existing_record.organization_id,
        existing_record.store_id,
        domain_type,
        existing_record.id,
      );

      if (updateData.is_primary === true) {
        updateData.status = 'active';
      }
    }

    const updates: any = {
      ...updateData,
      updated_at: new Date(),
    };

    // Si se está actualizando la configuración, sincronizar con otros dominios del mismo tipo
    if (updateData.config) {
      const { organization_id, store_id, domain_type: record_type } = existing_record;

      // Actualizar TODOS los dominios del mismo tipo para esta organización/tienda
      await this.prisma.domain_settings.updateMany({
        where: {
          organization_id,
          store_id,
          domain_type: record_type,
        },
        data: {
          config: updateData.config as any,
          updated_at: new Date(),
        },
      });

      this.logger.log(
        `Configuration synchronized across all ${record_type} domains for ${store_id ? 'store ' + store_id : 'org ' + organization_id
        }`,
      );
    }

    const updated = await this.prisma.domain_settings.update({
      where: { hostname },
      data: updates,
    });

    return updated;
  }

  async deleteDomainSetting(hostname: string) {
    await this.getDomainSettingByHostname(hostname);

    await this.prisma.domain_settings.delete({
      where: { hostname },
    });
  }

  async duplicateDomainSetting(hostname: string, newHostname: string) {
    const source = await this.getDomainSettingByHostname(hostname);

    // Check if new hostname is available
    const available = await this.checkHostnameAvailability(newHostname);
    if (!available.available) {
      throw new ConflictException(`Hostname ${newHostname} is not available`);
    }

    return this.createDomainSetting({
      hostname: newHostname,
      organization_id: source.organization_id,
      store_id: source.store_id,
      config: source.config as any,
      domain_type: source.domain_type,
      ownership: source.ownership,
      is_primary: false, // Duplicates are not primary by default
    });
  }

  async validateHostname(hostname: string) {
    const exists = await this.prisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      valid: !exists,
      hostname,
      ...(exists && { reason: 'Hostname already exists' }),
    };
  }

  async verifyDomain(
    hostname: string,
    body: VerifyDomainDto,
  ): Promise<VerifyDomainResult> {
    const domain = await this.getDomainSettingByHostname(hostname);

    // Basic verification logic
    const verifiable_types = ['custom_domain', 'custom_subdomain'];
    if (!verifiable_types.includes(domain.ownership)) {
      throw new BadRequestException('Domain type not verifiable');
    }

    const status_before = domain.status;

    // Simulate verification checks
    const checks_to_run = body.checks || ['cname'];

    const results: any = {};

    if (checks_to_run.includes('cname')) {
      try {
        const records = await dns.resolveCname(hostname);
        results.cname = { valid: records.length > 0 };
      } catch (error) {
        results.cname = { valid: false, reason: 'CNAME resolution failed' };
      }
    }

    const all_valid = Object.values(results).every((check: any) => check.valid);

    let status_after = status_before;
    let ssl_status = domain.ssl_status;

    if (all_valid) {
      status_after = 'active';
      ssl_status = 'issued';
      await this.prisma.domain_settings.update({
        where: { hostname },
        data: {
          status: 'active',
          ssl_status: 'issued',
          last_verified_at: new Date(),
        },
      });
    }

    return {
      hostname,
      status_before: status_before,
      status_after: status_after,
      ssl_status: ssl_status,
      verified: all_valid,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }
}
